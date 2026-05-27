const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nearwork-97e3c';
const DEFAULT_MODEL = 'gpt-5.4-mini';

function initAdmin() {
  if (admin.apps.length) return admin.app();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
    });
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  }
  throw new Error('Firebase Admin credentials are not configured');
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)])
  );
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(safeNumber(value))));
}

function answerText(question, answer) {
  const value = answer && typeof answer === 'object' ? answer.value : answer;
  if (Array.isArray(question.options) && value !== undefined && value !== '') {
    return question.options[Number(value)] || '';
  }
  return question.candidateAnswer || question.a || '';
}

function compactQuestions(assessment) {
  const answers = assessment.answers || {};
  return (assessment.questions || []).slice(0, 90).map((question, index) => {
    const answer = answers[question.id];
    const selected = answerText(question, answer);
    const correct = typeof question.correctIndex === 'number' && Array.isArray(question.options)
      ? question.options[question.correctIndex]
      : '';
    return {
      number: index + 1,
      part: question.part || question.type || '',
      skill: question.skill || question.bank || '',
      difficulty: question.difficulty || '',
      question: question.q || question.text || '',
      selectedAnswer: selected || 'Unanswered',
      correctAnswer: correct,
      correct: correct ? selected === correct : null
    };
  });
}

function defaultRadar(assessment, averages) {
  const technical = clampScore(assessment.technical || assessment.technicalScore || 0);
  const overall = clampScore(assessment.score || assessment.overallScore || 0);
  const disc = assessment.discProfile ? 82 : clampScore(assessment.discScore || 70);
  const english = String(assessment.english || '').includes('C1') ? 88 : 76;
  return [
    { label: 'Technical skill', candidate: technical, average: averages.technical },
    { label: 'Role fit', candidate: overall, average: averages.overall },
    { label: 'Communication', candidate: english, average: 78 },
    { label: 'Work style', candidate: disc, average: 74 },
    { label: 'Experience', candidate: Math.max(65, Math.min(90, overall - 2)), average: 72 }
  ];
}

async function getRoleAverages(db, assessment) {
  const role = assessment.role || assessment.openingTitle || '';
  if (!role) return { overall: 72, technical: 70 };
  const snap = await db.collection('assessments').where('role', '==', role).limit(50).get().catch(() => ({ docs: [] }));
  const completed = snap.docs
    .map(doc => doc.data())
    .filter(item => String(item.status || '').toLowerCase() === 'completed');
  if (!completed.length) return { overall: 72, technical: 70 };
  const overall = completed.reduce((sum, item) => sum + safeNumber(item.score || item.overallScore), 0) / completed.length;
  const technical = completed.reduce((sum, item) => sum + safeNumber(item.technical || item.technicalScore), 0) / completed.length;
  return { overall: clampScore(overall), technical: clampScore(technical) };
}

function fallbackReview(assessment, averages) {
  const technical = clampScore(assessment.technical || assessment.technicalScore || 0);
  const overall = clampScore(assessment.score || assessment.overallScore || 0);
  const discLabel = assessment.discProfile?.label || assessment.disc || 'DISC submitted';
  const radar = defaultRadar(assessment, averages);
  return {
    summaryTitle: technical >= averages.technical ? 'Above role benchmark with focused follow-ups' : 'Requires deeper technical validation',
    recommendation: technical >= 70 ? 'Move forward with a focused interview.' : 'Review answer detail before client presentation.',
    radar,
    bars: [
      { label: 'Overall', candidate: overall, average: averages.overall },
      { label: 'Technical', candidate: technical, average: averages.technical },
      { label: 'Work style', candidate: assessment.discProfile ? 82 : 72, average: 74 }
    ],
    internal: {
      summary: `The candidate completed the ${assessment.role || 'role'} assessment. Technical score is ${technical}% against a role average of ${averages.technical}%. DISC signal is ${discLabel}.`,
      strengths: ['Assessment completed on the assigned role path', 'Profile has enough signal for structured recruiter review'],
      watchouts: ['Validate missed technical areas live', 'Confirm role-specific examples before client presentation'],
      followUps: ['Review incorrect technical answers', 'Ask for a real scenario related to the weakest skill area'],
      interviewQuestions: ['Walk me through a recent problem similar to this role.', 'How do you prioritize when several issues are urgent?', 'Which tool or workflow from this role do you know best?'],
      recommendation: technical >= 70 ? 'Recommended for client review after targeted recruiter validation.' : 'Hold for recruiter review before sharing externally.'
    },
    client: {
      summary: `This candidate shows ${technical >= averages.technical ? 'above-average' : 'developing'} technical signal for ${assessment.role || 'this role'}, with ${discLabel} work-style indicators.`,
      technicalBreakdown: `Technical score: ${technical}%. Role average: ${averages.technical}%.`,
      discSummary: `${discLabel} can help the team understand communication style, collaboration pattern, and ideal management approach.`,
      strengths: ['Completed role-specific assessment', 'Shows useful signal for comparison against the role benchmark'],
      watchouts: ['Validate the lower-scoring areas during interview', 'Ask for concrete examples before final decision'],
      followUps: ['Run one live scenario', 'Ask about tool depth and escalation habits'],
      interviewGuide: ['Ask for a role-specific example', 'Validate prioritization under pressure', 'Confirm tool fluency']
    }
  };
}

function extractTextFromResponse(body) {
  if (body.output_text) return body.output_text;
  const chunks = [];
  (body.output || []).forEach(item => {
    (item.content || []).forEach(content => {
      if (content.text) chunks.push(content.text);
    });
  });
  return chunks.join('\n');
}

function parseJsonReview(text, assessment, averages) {
  try {
    const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      ...fallbackReview(assessment, averages),
      ...parsed,
      internal: { ...fallbackReview(assessment, averages).internal, ...(parsed.internal || {}) },
      client: { ...fallbackReview(assessment, averages).client, ...(parsed.client || {}) },
      radar: Array.isArray(parsed.radar) && parsed.radar.length ? parsed.radar.map(item => ({
        label: String(item.label || ''),
        candidate: clampScore(item.candidate),
        average: clampScore(item.average)
      })).filter(item => item.label) : defaultRadar(assessment, averages),
      bars: Array.isArray(parsed.bars) && parsed.bars.length ? parsed.bars.map(item => ({
        label: String(item.label || ''),
        candidate: clampScore(item.candidate),
        average: clampScore(item.average)
      })).filter(item => item.label) : fallbackReview(assessment, averages).bars
    };
  } catch (error) {
    return fallbackReview(assessment, averages);
  }
}

async function generateWithOpenAI(assessment, averages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const prompt = {
    task: 'Generate Nearwork AI Assessment Insights. Return only valid JSON.',
    rules: [
      'Do not mention OpenAI, AI model names, tokens, cost, or hidden scoring formulas.',
      'Do not expose correct answers in the client section.',
      'Use role benchmarks and candidate scores to create practical client-facing context.',
      'Keep language professional, concise, and useful for hiring decisions.',
      'Never make a final hiring decision; recommend next review steps.'
    ],
    outputShape: {
      summaryTitle: 'short headline',
      recommendation: 'short internal recommendation',
      radar: [{ label: 'Technical skill', candidate: 78, average: 71 }],
      bars: [{ label: 'Technical', candidate: 78, average: 71 }],
      internal: {
        summary: 'full Nearwork recruiter summary',
        strengths: ['3-5 bullets'],
        watchouts: ['3-5 bullets'],
        followUps: ['3-5 bullets'],
        interviewQuestions: ['4-6 questions'],
        recommendation: 'what Nearwork should do next'
      },
      client: {
        summary: 'partner-safe assessment explanation',
        technicalBreakdown: 'technical score with role average context',
        discSummary: 'DISC explanation with benefits and watchouts',
        strengths: ['3-5 bullets'],
        watchouts: ['3-5 bullets'],
        followUps: ['3-5 bullets'],
        interviewGuide: ['4-6 client interview questions']
      }
    },
    candidate: {
      name: assessment.candidateName,
      role: assessment.role,
      overallScore: assessment.score || assessment.overallScore,
      technicalScore: assessment.technical || assessment.technicalScore,
      disc: assessment.discProfile || assessment.disc,
      skills: assessment.banks || [],
      roleAverages: averages
    },
    questionResults: compactQuestions(assessment)
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: 'You are Nearwork assessment intelligence. You summarize evidence for recruiters and hiring partners without revealing answer keys to partners.'
        },
        {
          role: 'user',
          content: JSON.stringify(prompt)
        }
      ]
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Assessment insight generation failed');
  return parseJsonReview(extractTextFromResponse(body), assessment, averages);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  try {
    initAdmin();
    const db = admin.firestore();
    const { assessmentId } = req.body || {};
    if (!assessmentId) return res.status(400).json({ ok:false, error:'Missing assessmentId' });

    const assessmentSnap = await db.collection('assessments').doc(assessmentId).get();
    if (!assessmentSnap.exists) return res.status(404).json({ ok:false, error:'Assessment not found' });
    const assessment = { id: assessmentSnap.id, ...assessmentSnap.data() };
    const averages = await getRoleAverages(db, assessment);
    const review = await generateWithOpenAI(assessment, averages);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const reviewId = 'AIR-' + Date.now().toString(36).toUpperCase();
    const fullReview = stripUndefined({
      id: reviewId,
      assessmentId,
      candidateCode: assessment.candidateCode || '',
      candidateName: assessment.candidateName || '',
      candidateEmail: assessment.candidateEmail || '',
      openingCode: assessment.openingCode || '',
      pipelineCode: assessment.pipelineCode || '',
      orgId: assessment.orgId || '',
      orgName: assessment.orgName || '',
      role: assessment.role || '',
      summaryTitle: review.summaryTitle,
      recommendation: review.recommendation,
      radar: review.radar,
      bars: review.bars,
      internal: review.internal,
      client: review.client,
      generatedAt: now,
      generatedBy: 'nearwork-assessment-insights'
    });

    await db.collection('assessments').doc(assessmentId).collection('aiReviews').doc(reviewId).set(fullReview, { merge:true });
    await db.collection('assessments').doc(assessmentId).set(stripUndefined({
      latestAiReviewId: reviewId,
      latestAiReviewClient: review.client,
      latestAiReviewVisuals: {
        summaryTitle: review.summaryTitle,
        radar: review.radar,
        bars: review.bars,
        recommendation: review.recommendation
      },
      aiReviewUpdatedAt: now,
      updatedAt: now
    }), { merge:true });

    return res.status(200).json({ ok:true, review: fullReview });
  } catch (error) {
    console.error('generate-assessment-insights error:', error);
    return res.status(500).json({ ok:false, error:error.message || 'Could not generate assessment insights' });
  }
};
