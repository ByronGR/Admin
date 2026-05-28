// ─── Nearwork Assessment Question Bank ────────────────────────────────────────
// 50 technical + 25 DISC questions, generated and hardcoded.
// Technical questions span 6 skill categories.
// DISC questions map each option to a behavioral style (D/I/S/C).

import type { DISCStyle } from './types';

export interface TechnicalQuestion {
  id: string;
  text: string;
  category: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface DISCQuestion {
  id: string;
  text: string;
  options: Array<{ text: string; style: DISCStyle }>;
}

// ─── Technical Questions ──────────────────────────────────────────────────────

export const TECHNICAL_QUESTIONS: TechnicalQuestion[] = [
  // ── General Problem Solving & Aptitude ──
  {
    id: 'T01',
    text: 'A company receives 240 applications in 8 weeks. Assuming a 5-day work week, how many applications arrive per day?',
    category: 'Problem Solving',
    options: ['5', '6', '7', '8'],
    correctIndex: 1,
    explanation: '240 applications ÷ 8 weeks ÷ 5 days = 6 per day.',
  },
  {
    id: 'T02',
    text: 'Revenue grew 20% year-over-year. Total revenue this year is $120,000. What was last year\'s revenue?',
    category: 'Problem Solving',
    options: ['$96,000', '$100,000', '$144,000', '$98,000'],
    correctIndex: 1,
    explanation: '$120,000 ÷ 1.20 = $100,000.',
  },
  {
    id: 'T03',
    text: 'A team completes 3 projects every 6 months. At the same rate, how many projects will they complete in 2 years?',
    category: 'Problem Solving',
    options: ['10', '12', '8', '14'],
    correctIndex: 1,
    explanation: '3 projects per 6 months × 4 periods = 12 projects.',
  },
  {
    id: 'T04',
    text: '15 is what percentage of 60?',
    category: 'Problem Solving',
    options: ['15%', '20%', '25%', '30%'],
    correctIndex: 2,
    explanation: '15 ÷ 60 × 100 = 25%.',
  },
  {
    id: 'T05',
    text: 'When analyzing data, an outlier is best described as:',
    category: 'Problem Solving',
    options: [
      'The most common value in the dataset',
      'A data point significantly far from the others',
      'The average of all values',
      'The most recently entered record',
    ],
    correctIndex: 1,
  },
  {
    id: 'T06',
    text: 'You receive conflicting instructions from two managers. What is the best approach?',
    category: 'Problem Solving',
    options: [
      'Follow the most recent instruction without question',
      'Do nothing until someone resolves it for you',
      'Clarify with both managers and align on the priority',
      'Ignore both and use your own judgment',
    ],
    correctIndex: 2,
  },
  {
    id: 'T07',
    text: 'You have 3 hours to finish a task that normally takes 5. What should you do?',
    category: 'Problem Solving',
    options: [
      'Skip random parts of the task',
      'Focus on the highest-value components and communicate the constraint',
      'Ask someone to do it entirely in your place',
      'Rush through without any planning',
    ],
    correctIndex: 1,
  },
  {
    id: 'T08',
    text: 'Which framework is most useful for prioritizing tasks by urgency and importance?',
    category: 'Problem Solving',
    options: [
      'Random selection',
      'Alphabetical order by task name',
      'Eisenhower Matrix',
      'Alphabetical order by task owner',
    ],
    correctIndex: 2,
  },
  {
    id: 'T09',
    text: 'Which cognitive skill is most essential for a recruiter?',
    category: 'Problem Solving',
    options: ['Memorization', 'Active listening', 'Fast typing', 'Public speaking'],
    correctIndex: 1,
  },
  {
    id: 'T10',
    text: 'If a price drops from $80 to $60, what is the percentage decrease?',
    category: 'Problem Solving',
    options: ['20%', '25%', '30%', '33%'],
    correctIndex: 1,
    explanation: '($80 - $60) ÷ $80 × 100 = 25%.',
  },

  // ── Communication & Customer Relations ──
  {
    id: 'T11',
    text: 'A client is upset about a delayed placement. What is your first step?',
    category: 'Communication',
    options: [
      'Blame the delay on the candidate',
      'Apologize, acknowledge the impact, and present a clear plan',
      'Ignore the situation until it resolves itself',
      'Transfer the client to another representative',
    ],
    correctIndex: 1,
  },
  {
    id: 'T12',
    text: '"Active listening" includes which of the following?',
    category: 'Communication',
    options: [
      'Interrupting with solutions immediately',
      'Nodding, paraphrasing, and asking clarifying questions',
      'Waiting for your turn to speak',
      'Multitasking while the other person talks',
    ],
    correctIndex: 1,
  },
  {
    id: 'T13',
    text: 'What is the best email subject for an urgent review request?',
    category: 'Communication',
    options: ['"Hey"', '"URGENT: Please review by EOD today"', '"Question"', '"FYI"'],
    correctIndex: 1,
  },
  {
    id: 'T14',
    text: 'A candidate goes silent after receiving an offer. What is the best approach?',
    category: 'Communication',
    options: [
      'Move on and fill the role with someone else immediately',
      'Send one follow-up message checking in and respect their timeline',
      'Call them every hour until they respond',
      'Rescind the offer immediately',
    ],
    correctIndex: 1,
  },
  {
    id: 'T15',
    text: 'Professional feedback should be:',
    category: 'Communication',
    options: [
      'General and subjective',
      'Specific, actionable, and respectful',
      'Only positive',
      'Delivered publicly for maximum impact',
    ],
    correctIndex: 1,
  },
  {
    id: 'T16',
    text: 'When presenting a candidate to a client, what is most important?',
    category: 'Communication',
    options: [
      'Listing every job the candidate has ever had',
      'Highlighting alignment with the role requirements',
      'Leading with the candidate\'s salary expectations',
      'Mentioning weaknesses before strengths',
    ],
    correctIndex: 1,
  },
  {
    id: 'T17',
    text: 'Which tone is most appropriate in professional written communication?',
    category: 'Communication',
    options: [
      'Informal and casual',
      'Aggressive and very direct',
      'Clear, respectful, and concise',
      'Overly formal with archaic language',
    ],
    correctIndex: 2,
  },
  {
    id: 'T18',
    text: 'Cross-cultural communication requires:',
    category: 'Communication',
    options: [
      'Assuming everyone communicates the same way',
      'Speaking loudly and slowly',
      'Awareness of cultural norms and adjusting your communication style',
      'Only communicating in English',
    ],
    correctIndex: 2,
  },
  {
    id: 'T19',
    text: 'A client requests a candidate profile outside your current pipeline. You should:',
    category: 'Communication',
    options: [
      'Decline immediately',
      'Acknowledge the request, ask for details, and assess feasibility',
      'Promise delivery without knowing the timeline',
      'Ignore the request',
    ],
    correctIndex: 1,
  },
  {
    id: 'T20',
    text: 'A candidate asks why they were not selected. The best response is:',
    category: 'Communication',
    options: [
      '"I can\'t share that information."',
      'Provide specific, constructive feedback based on the evaluation',
      'Tell them to apply again later',
      'Say nothing and end the call',
    ],
    correctIndex: 1,
  },

  // ── Data & Analytics ──
  {
    id: 'T21',
    text: 'In a spreadsheet, which function returns the total of a range of values?',
    category: 'Data & Analytics',
    options: ['COUNT()', 'AVERAGE()', 'SUM()', 'MAX()'],
    correctIndex: 2,
  },
  {
    id: 'T22',
    text: 'A conversion rate of 8% means:',
    category: 'Data & Analytics',
    options: [
      '8 out of 1,000 convert',
      '8 out of 100 convert',
      '80 out of 100 convert',
      '8 out of 10 convert',
    ],
    correctIndex: 1,
  },
  {
    id: 'T23',
    text: 'Which chart type best displays trends over time?',
    category: 'Data & Analytics',
    options: ['Pie chart', 'Bar chart', 'Line chart', 'Scatter plot'],
    correctIndex: 2,
  },
  {
    id: 'T24',
    text: 'The correct formula for percentage change from an old to a new value is:',
    category: 'Data & Analytics',
    options: [
      '(new − old) ÷ old × 100',
      '(old − new) ÷ new × 100',
      'new ÷ old × 100',
      'old ÷ new × 100',
    ],
    correctIndex: 0,
  },
  {
    id: 'T25',
    text: 'In recruiting metrics, "time-to-fill" measures:',
    category: 'Data & Analytics',
    options: [
      'How long candidates are kept on hold',
      'The number of candidates per opening',
      'Days from job opening creation to offer acceptance',
      'Days from first interview to start date',
    ],
    correctIndex: 2,
  },
  {
    id: 'T26',
    text: 'What does KPI stand for?',
    category: 'Data & Analytics',
    options: [
      'Key Program Index',
      'Key Performance Indicator',
      'Known Process Input',
      'Key Productivity Item',
    ],
    correctIndex: 1,
  },
  {
    id: 'T27',
    text: 'A dataset has values: 2, 4, 4, 4, 5, 5, 7, 9. What is the mode?',
    category: 'Data & Analytics',
    options: ['5', '4', '5.5', '4.5'],
    correctIndex: 1,
    explanation: 'The mode is the most frequently occurring value — 4 appears 3 times.',
  },
  {
    id: 'T28',
    text: 'What does "data normalization" mean?',
    category: 'Data & Analytics',
    options: [
      'Deleting all duplicate records',
      'Scaling or structuring data to a consistent standard',
      'Adding more rows to a dataset',
      'Sorting data alphabetically',
    ],
    correctIndex: 1,
  },

  // ── Technology & Digital Tools ──
  {
    id: 'T29',
    text: 'CRM stands for:',
    category: 'Technology',
    options: [
      'Client Revenue Management',
      'Customer Relationship Management',
      'Contact Record Module',
      'Central Resource Monitor',
    ],
    correctIndex: 1,
  },
  {
    id: 'T30',
    text: 'ATS in recruiting stands for:',
    category: 'Technology',
    options: [
      'Automated Talent Search',
      'Applicant Tracking System',
      'Advanced Testing System',
      'Annual Talent Score',
    ],
    correctIndex: 1,
  },
  {
    id: 'T31',
    text: 'What is a VPN primarily used for?',
    category: 'Technology',
    options: [
      'Speeding up your computer',
      'Creating a secure and private internet connection',
      'Storing passwords',
      'Managing email',
    ],
    correctIndex: 1,
  },
  {
    id: 'T32',
    text: 'Two-factor authentication (2FA) adds security by:',
    category: 'Technology',
    options: [
      'Using a longer password',
      'Requiring a second verification step beyond the password',
      'Encrypting your hard drive',
      'Blocking access from other countries',
    ],
    correctIndex: 1,
  },
  {
    id: 'T33',
    text: 'What does API stand for?',
    category: 'Technology',
    options: [
      'Automated Programming Input',
      'Application Programming Interface',
      'Advanced Process Integration',
      'Authorized Program Index',
    ],
    correctIndex: 1,
  },
  {
    id: 'T34',
    text: 'What is the function of VLOOKUP in a spreadsheet?',
    category: 'Technology',
    options: [
      'Format cells visually',
      'Find a value in a column and return data from a specified adjacent column',
      'Create charts automatically',
      'Sort rows in ascending order',
    ],
    correctIndex: 1,
  },
  {
    id: 'T35',
    text: 'Phishing emails are designed to:',
    category: 'Technology',
    options: [
      'Improve spam filters',
      'Trick users into revealing sensitive information',
      'Test network speed',
      'Update software automatically',
    ],
    correctIndex: 1,
  },
  {
    id: 'T36',
    text: 'Cloud storage is primarily used for:',
    category: 'Technology',
    options: [
      'Increasing processing power',
      'Storing and accessing files remotely over the internet',
      'Improving internet connection speed',
      'Running desktop applications',
    ],
    correctIndex: 1,
  },

  // ── Project Management & Operations ──
  {
    id: 'T37',
    text: 'Agile methodology primarily focuses on:',
    category: 'Project Management',
    options: [
      'Rigid upfront planning and sequential execution',
      'Iterative development with flexibility to adapt',
      'Maximum documentation at every stage',
      'A single large delivery at project end',
    ],
    correctIndex: 1,
  },
  {
    id: 'T38',
    text: 'A project is behind schedule. What is the best first action?',
    category: 'Project Management',
    options: [
      'Add more people to the team immediately',
      'Assess the root cause, re-scope if needed, and communicate the impact',
      'Ignore it and hope to catch up',
      'Extend the deadline without telling stakeholders',
    ],
    correctIndex: 1,
  },
  {
    id: 'T39',
    text: 'A RACI chart defines:',
    category: 'Project Management',
    options: [
      'Project budget allocation',
      'Roles: Responsible, Accountable, Consulted, Informed',
      'Risk assessment categories',
      'Release and configuration items',
    ],
    correctIndex: 1,
  },
  {
    id: 'T40',
    text: '"Scope creep" refers to:',
    category: 'Project Management',
    options: [
      'Team members leaving the project',
      'Uncontrolled expansion of project requirements over time',
      'Budget overruns due to inflation',
      'Late delivery of the final product',
    ],
    correctIndex: 1,
  },
  {
    id: 'T41',
    text: 'Which document outlines a project\'s objectives, deliverables, and timeline?',
    category: 'Project Management',
    options: ['Invoice', 'Project charter', 'Meeting minutes', 'Risk log'],
    correctIndex: 1,
  },

  // ── HR & Recruiting Knowledge ──
  {
    id: 'T42',
    text: 'CEFR levels are used to measure:',
    category: 'HR & Recruiting',
    options: [
      'Technical skills',
      'Language proficiency',
      'Personality traits',
      'Years of work experience',
    ],
    correctIndex: 1,
  },
  {
    id: 'T43',
    text: 'An onboarding process typically includes:',
    category: 'HR & Recruiting',
    options: [
      'Performance reviews',
      'Orientation, paperwork, training, and introductions',
      'Exit interviews',
      'Salary renegotiation',
    ],
    correctIndex: 1,
  },
  {
    id: 'T44',
    text: 'EOR (Employer of Record) means:',
    category: 'HR & Recruiting',
    options: [
      'The company that owns the office space',
      'A third party legally employing contractors on behalf of a client company',
      'An HR software vendor',
      'An employment rights organization',
    ],
    correctIndex: 1,
  },
  {
    id: 'T45',
    text: 'A "counter-offer" in recruiting occurs when:',
    category: 'HR & Recruiting',
    options: [
      'A candidate rejects all offers',
      'A current employer offers better terms to retain an employee considering leaving',
      'Two clients compete for the same candidate',
      'A recruiter negotiates on behalf of the client',
    ],
    correctIndex: 1,
  },
  {
    id: 'T46',
    text: 'What is a "purple squirrel" in recruiting?',
    category: 'HR & Recruiting',
    options: [
      'A highly sought-after but unrealistically perfect candidate',
      'A candidate with unconventional appearance',
      'An internal employee referral',
      'A VP-level hire',
    ],
    correctIndex: 0,
  },
  {
    id: 'T47',
    text: 'SQL stands for:',
    category: 'Technology',
    options: [
      'System Query Link',
      'Sequential Query List',
      'Structured Query Language',
      'Standard Question Logic',
    ],
    correctIndex: 2,
  },
  {
    id: 'T48',
    text: 'Which of the following best describes "data-driven decision making"?',
    category: 'Data & Analytics',
    options: [
      'Using gut instinct supported by a single data point',
      'Making choices based on analysis of relevant data',
      'Collecting as much data as possible without analysis',
      'Letting algorithms decide everything',
    ],
    correctIndex: 1,
  },
  {
    id: 'T49',
    text: 'Which of these is a project management tool?',
    category: 'Technology',
    options: ['Adobe Photoshop', 'Asana', 'Spotify', 'VLC Media Player'],
    correctIndex: 1,
  },
  {
    id: 'T50',
    text: 'A recruiter\'s "pipeline" refers to:',
    category: 'HR & Recruiting',
    options: [
      'The software infrastructure of the recruiting platform',
      'The pool of candidates at various stages of the hiring process',
      'A document with job descriptions',
      'The org chart of the client company',
    ],
    correctIndex: 1,
  },
];

// ─── DISC Questions ───────────────────────────────────────────────────────────

export const DISC_QUESTIONS: DISCQuestion[] = [
  {
    id: 'D01',
    text: 'When you start a new project, you typically:',
    options: [
      { text: 'Dive in and focus on results quickly', style: 'D' },
      { text: 'Rally the team and build shared excitement', style: 'I' },
      { text: 'Create a steady plan and follow it step by step', style: 'S' },
      { text: 'Research thoroughly before taking any action', style: 'C' },
    ],
  },
  {
    id: 'D02',
    text: 'In a conflict, you tend to:',
    options: [
      { text: 'Address it head-on and push for resolution', style: 'D' },
      { text: 'Talk it through and find common ground', style: 'I' },
      { text: 'Avoid conflict to maintain harmony', style: 'S' },
      { text: 'Analyze the facts to find the best solution', style: 'C' },
    ],
  },
  {
    id: 'D03',
    text: 'Your colleagues would describe you as:',
    options: [
      { text: 'Determined and results-driven', style: 'D' },
      { text: 'Energetic and fun to be around', style: 'I' },
      { text: 'Reliable and easy to work with', style: 'S' },
      { text: 'Thorough and detail-oriented', style: 'C' },
    ],
  },
  {
    id: 'D04',
    text: 'When making decisions, you:',
    options: [
      { text: 'Decide quickly based on what gets results', style: 'D' },
      { text: 'Consider how it affects relationships first', style: 'I' },
      { text: 'Take time to gather consensus', style: 'S' },
      { text: 'Collect all available data before deciding', style: 'C' },
    ],
  },
  {
    id: 'D05',
    text: 'You feel most productive when:',
    options: [
      { text: 'You\'re in charge and driving outcomes', style: 'D' },
      { text: 'You\'re collaborating and connecting with people', style: 'I' },
      { text: 'You have a clear, stable routine', style: 'S' },
      { text: 'You\'re solving complex, detailed problems', style: 'C' },
    ],
  },
  {
    id: 'D06',
    text: 'Under pressure, you:',
    options: [
      { text: 'Become more focused and demanding', style: 'D' },
      { text: 'Seek support and talk to others', style: 'I' },
      { text: 'Stay calm and patient', style: 'S' },
      { text: 'Become more careful and precise', style: 'C' },
    ],
  },
  {
    id: 'D07',
    text: 'Your work style is best described as:',
    options: [
      { text: 'Fast-paced and goal-oriented', style: 'D' },
      { text: 'Open, social, and motivating', style: 'I' },
      { text: 'Consistent, supportive, and methodical', style: 'S' },
      { text: 'Systematic, accurate, and thorough', style: 'C' },
    ],
  },
  {
    id: 'D08',
    text: 'When you receive feedback, you:',
    options: [
      { text: 'Focus on how to improve results faster', style: 'D' },
      { text: 'Appreciate when it\'s delivered warmly', style: 'I' },
      { text: 'Take it calmly and try to maintain good relations', style: 'S' },
      { text: 'Want specific details and concrete examples', style: 'C' },
    ],
  },
  {
    id: 'D09',
    text: 'In team meetings, you typically:',
    options: [
      { text: 'Take the lead and steer toward action', style: 'D' },
      { text: 'Keep energy high and get everyone involved', style: 'I' },
      { text: 'Listen more than you speak', style: 'S' },
      { text: 'Ask clarifying questions and seek accuracy', style: 'C' },
    ],
  },
  {
    id: 'D10',
    text: 'Your biggest motivator at work is:',
    options: [
      { text: 'Achieving goals and winning', style: 'D' },
      { text: 'Recognition and connection with others', style: 'I' },
      { text: 'Stability, security, and appreciation', style: 'S' },
      { text: 'Quality work and getting things right', style: 'C' },
    ],
  },
  {
    id: 'D11',
    text: 'When you disagree with a decision, you:',
    options: [
      { text: 'Say so directly and challenge it openly', style: 'D' },
      { text: 'Try to influence others with enthusiasm', style: 'I' },
      { text: 'Accept it unless it causes significant harm', style: 'S' },
      { text: 'Present data and logic to counter it', style: 'C' },
    ],
  },
  {
    id: 'D12',
    text: 'Your biggest fear at work is:',
    options: [
      { text: 'Being seen as weak or losing control', style: 'D' },
      { text: 'Being rejected or ignored by others', style: 'I' },
      { text: 'Sudden change or instability', style: 'S' },
      { text: 'Making mistakes or being wrong', style: 'C' },
    ],
  },
  {
    id: 'D13',
    text: 'When you\'re given a vague project, you:',
    options: [
      { text: 'Define the goal yourself and start immediately', style: 'D' },
      { text: 'Discuss it with others to build a shared vision', style: 'I' },
      { text: 'Ask for clear guidelines before starting', style: 'S' },
      { text: 'Map out all requirements systematically first', style: 'C' },
    ],
  },
  {
    id: 'D14',
    text: 'You prefer work environments that are:',
    options: [
      { text: 'Fast-paced, challenging, with autonomy', style: 'D' },
      { text: 'Social, open, and encouraging', style: 'I' },
      { text: 'Structured, predictable, and collaborative', style: 'S' },
      { text: 'Organized, precise, and quality-focused', style: 'C' },
    ],
  },
  {
    id: 'D15',
    text: 'Your natural leadership style is:',
    options: [
      { text: 'Direct and authoritative', style: 'D' },
      { text: 'Inspirational and people-focused', style: 'I' },
      { text: 'Supportive and consensus-driven', style: 'S' },
      { text: 'Analytical and process-driven', style: 'C' },
    ],
  },
  {
    id: 'D16',
    text: 'When dealing with a difficult person, you:',
    options: [
      { text: 'Confront directly and set clear boundaries', style: 'D' },
      { text: 'Try to win them over with energy and charm', style: 'I' },
      { text: 'Stay patient and find common ground', style: 'S' },
      { text: 'Observe their behavior and adapt methodically', style: 'C' },
    ],
  },
  {
    id: 'D17',
    text: 'You prefer to communicate:',
    options: [
      { text: 'Briefly and to the point', style: 'D' },
      { text: 'Openly, with stories and enthusiasm', style: 'I' },
      { text: 'In a friendly, low-pressure way', style: 'S' },
      { text: 'With facts, data, and organized thoughts', style: 'C' },
    ],
  },
  {
    id: 'D18',
    text: 'When starting a new job, your first priority is:',
    options: [
      { text: 'Identifying opportunities to make a quick impact', style: 'D' },
      { text: 'Building relationships with the team', style: 'I' },
      { text: 'Learning the existing processes and fitting in', style: 'S' },
      { text: 'Understanding the full scope and all procedures', style: 'C' },
    ],
  },
  {
    id: 'D19',
    text: 'In your ideal workday, you would:',
    options: [
      { text: 'Knock out high-impact tasks and move fast', style: 'D' },
      { text: 'Collaborate, brainstorm, and connect with people', style: 'I' },
      { text: 'Follow a consistent, manageable schedule', style: 'S' },
      { text: 'Work deeply on complex, focused problems', style: 'C' },
    ],
  },
  {
    id: 'D20',
    text: 'Others sometimes criticize you for being:',
    options: [
      { text: 'Too blunt or impatient', style: 'D' },
      { text: 'Too talkative or impulsive', style: 'I' },
      { text: 'Too passive or resistant to change', style: 'S' },
      { text: 'Too rigid or slow to make decisions', style: 'C' },
    ],
  },
  {
    id: 'D21',
    text: 'When your team makes a mistake, you:',
    options: [
      { text: 'Identify the issue and fix it as quickly as possible', style: 'D' },
      { text: 'Keep spirits up and focus on solutions', style: 'I' },
      { text: 'Support the team and avoid assigning blame', style: 'S' },
      { text: 'Analyze what went wrong to prevent recurrence', style: 'C' },
    ],
  },
  {
    id: 'D22',
    text: 'Your best strength in a team is:',
    options: [
      { text: 'Driving results and keeping everyone focused', style: 'D' },
      { text: 'Energizing the team and building morale', style: 'I' },
      { text: 'Being a stabilizing, dependable presence', style: 'S' },
      { text: 'Ensuring accuracy and maintaining high quality', style: 'C' },
    ],
  },
  {
    id: 'D23',
    text: 'When you\'re stressed, you:',
    options: [
      { text: 'Push harder and become more controlling', style: 'D' },
      { text: 'Talk to others and seek emotional support', style: 'I' },
      { text: 'Withdraw and need time to recalibrate', style: 'S' },
      { text: 'Overanalyze and become indecisive', style: 'C' },
    ],
  },
  {
    id: 'D24',
    text: 'You value colleagues who are:',
    options: [
      { text: 'Competent, efficient, and results-driven', style: 'D' },
      { text: 'Positive, creative, and relationship-oriented', style: 'I' },
      { text: 'Loyal, steady, and genuinely team-oriented', style: 'S' },
      { text: 'Accurate, careful, and methodical', style: 'C' },
    ],
  },
  {
    id: 'D25',
    text: 'Your ideal form of recognition looks like:',
    options: [
      { text: 'Promotion, authority, and new challenges', style: 'D' },
      { text: 'Public praise, awards, and acknowledgment', style: 'I' },
      { text: 'Sincere appreciation, job security, and team harmony', style: 'S' },
      { text: 'Having your expertise and quality of work recognized', style: 'C' },
    ],
  },
];

// ─── DISC Style Labels ────────────────────────────────────────────────────────

export const DISC_LABELS: Record<DISCStyle, { name: string; description: string }> = {
  D: {
    name: 'Dominance',
    description: 'Direct, decisive, results-oriented, and competitive.',
  },
  I: {
    name: 'Influence',
    description: 'Enthusiastic, optimistic, collaborative, and communicative.',
  },
  S: {
    name: 'Steadiness',
    description: 'Patient, supportive, reliable, and team-oriented.',
  },
  C: {
    name: 'Conscientiousness',
    description: 'Analytical, precise, systematic, and quality-focused.',
  },
};

// ─── Scoring helper ───────────────────────────────────────────────────────────

export function scoreDISC(answers: Record<string, DISCStyle>): {
  style: DISCStyle;
  scores: Record<DISCStyle, number>;
} {
  const scores: Record<DISCStyle, number> = { D: 0, I: 0, S: 0, C: 0 };
  Object.values(answers).forEach((s) => {
    if (s in scores) scores[s]++;
  });
  const style = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as DISCStyle;
  return { style, scores };
}
