/* Build a lightweight shared entrypoint for GitHub Pages and extracted local ZIP use.
 * Runtime assets stay as ordinary sibling files; drawing never uses network APIs. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value, 'utf8');
function assert(ok, message) { if (!ok) throw new Error(message); }

function validateQuestionData() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read('courses/social-culture/content.js'), context, { filename: 'courses/social-culture/content.js' });
  vm.runInContext(read('js/course-registry.js'), context, { filename: 'js/course-registry.js' });
  vm.runInContext(read('js/data.js'), context, { filename: 'js/data.js' });
  vm.runInContext(read('courses/social-culture/assessments.js'), context, { filename: 'courses/social-culture/assessments.js' });
  vm.runInContext(read('js/exams.js'), context, { filename: 'js/exams.js' });
  vm.runInContext(read('js/predict.js'), context, { filename: 'js/predict.js' });
  vm.runInContext(read('js/assessment-engine.js'), context, { filename: 'js/assessment-engine.js' });

  const registry = context.window.StudyCourseRegistry;
  assert(registry && typeof registry.listAvailable === 'function', 'Course registry did not initialize.');
  const availableCourses = Array.from(registry.listAvailable());
  assert(availableCourses.length === 1, 'Expected only the content-ready Social & Culture course to be available.');
  const socialCulture = registry.get('social-culture');
  assert(socialCulture && socialCulture.status === 'available', 'The Social & Culture course is missing or unavailable.');
  assert(socialCulture.contentKey === 'social-culture', 'The Social & Culture course has no content module key.');
  const courseContent = registry.getContent('social-culture');
  assert(courseContent && Array.isArray(courseContent.units) && Array.isArray(courseContent.questions) && courseContent.concepts, 'The Social & Culture content module did not resolve.');
  assert(courseContent.units.length === 5 && courseContent.questions.length === 62 && Object.keys(courseContent.concepts).length === 5, 'The separated Social & Culture module has unexpected content counts.');
  assert(courseContent.units === context.UNITS && courseContent.questions === context.QUESTIONS && courseContent.concepts === context.CONCEPTS, 'The compatibility adapter is not exposing the registered course data.');
  const assessmentData = registry.getAssessmentData('social-culture');
  assert(assessmentData && assessmentData.schemaVersion === 1, 'The Social & Culture assessment module did not resolve.');
  assert(assessmentData.officialExams === context.EXAMS && assessmentData.practiceExams === context.PREDICT_EXAMS, 'The assessment compatibility adapters are not exposing the registered exam data.');
  assert(socialCulture.educationStage === 'high-school' && socialCulture.discipline === 'social-sciences', 'The Social & Culture course classification is invalid.');
  assert(socialCulture.content.unitCount === 5 && socialCulture.content.conceptQuestionCount === 62, 'Course content metadata does not match the existing question bank.');
  const officialProfile = registry.getAssessmentProfile('social-culture', 'official-mock');
  const predictProfile = registry.getAssessmentProfile('social-culture', 'predict-mock');
  const matchedOfficial = registry.findAssessmentProfileForExam({ id: '2026_suneung', kind: 'suneung' });
  const matchedPredict = registry.findAssessmentProfileForExam({ id: 'predict_mock_1', kind: 'predict' });
  assert(matchedOfficial && matchedOfficial.profile.id === 'official-mock', 'Official exam profile matching failed.');
  assert(matchedPredict && matchedPredict.profile.id === 'predict-mock', 'Practice exam profile matching failed.');
  assert(registry.findAssessmentProfileForExam({ id: '2026_suneung', kind: 'suneung' }, 'unknown-course') === null,
    'Assessment profiles must not match across course boundaries.');
  for (const profile of [officialProfile, predictProfile]) {
    assert(profile && profile.durationSec === 1800 && profile.questionCount === 20 && profile.choiceCount === 5 && profile.maxScore === 50, 'An assessment profile does not match the current mock exam format.');
  }

  const base = vm.runInContext('({ units: UNITS, questions: QUESTIONS, concepts: CONCEPTS })', context);
  assert(base.units.length === 5, 'Expected 5 units; found ' + base.units.length + '.');
  assert(base.questions.length === 62, 'Expected 62 concept questions; found ' + base.questions.length + '.');
  assert(Object.keys(base.concepts).length === 5, 'Expected concepts for 5 units.');
  const unitIds = new Set(base.units.map(unit => unit.id));
  for (const q of base.questions) {
    assert(unitIds.has(q.u), 'Concept question ' + q.id + ' refers to missing unit ' + q.u + '.');
    assert(typeof q.q === 'string' && q.q.length > 0, 'Question ' + q.id + ' has no prompt.');
    assert(Array.isArray(q.c) && q.c.length === 5, 'Question ' + q.id + ' does not have five choices.');
    assert(Number.isInteger(q.a) && q.a >= 0 && q.a <= 4, 'Question ' + q.id + ' has an invalid answer index.');
    assert(typeof q.e === 'string' && q.e.length > 0, 'Question ' + q.id + ' has no explanation.');
  }

  const exams = Array.from(vm.runInContext('EXAMS', context));
  assert(exams.length === 15, 'Expected 15 official exam sessions; found ' + exams.length + '.');
  assert(exams.reduce((sum, exam) => sum + exam.questions.length, 0) === 300, 'Expected 300 official exam answer records.');
  for (const exam of exams) {
    assert(exam.questions.length === 20, 'Exam ' + exam.id + ' does not contain 20 questions.');
    for (let i = 0; i < exam.questions.length; i += 1) {
      const q = exam.questions[i];
      assert(q.n === i + 1, 'Exam ' + exam.id + ' has an out-of-order question number.');
      assert(Number.isInteger(q.ans) && q.ans >= 0 && q.ans <= 4, 'Exam ' + exam.id + ' question ' + q.n + ' has an invalid answer.');
      assert(q.pts === 2 || q.pts === 3, 'Exam ' + exam.id + ' question ' + q.n + ' has an invalid point value.');
    }
  }

  const predict = Array.from(vm.runInContext('PREDICT_EXAMS', context));
  assert(predict.length === 3, 'Expected 3 self-made mock exams; found ' + predict.length + '.');
  assert(predict.reduce((sum, exam) => sum + exam.questions.length, 0) === 60, 'Expected 60 self-made mock questions.');
  for (const exam of predict) for (const q of exam.questions) {
    assert(Array.isArray(q.c) && q.c.length === 5, 'Predict exam ' + exam.id + ' question ' + q.n + ' does not have five choices.');
    assert(Number.isInteger(q.a) && q.a >= 0 && q.a <= 4, 'Predict exam ' + exam.id + ' question ' + q.n + ' has an invalid answer.');
    assert(typeof q.e === 'string' && q.e.length > 0, 'Predict exam ' + exam.id + ' question ' + q.n + ' has no explanation.');
  }
  const engine = context.window.AssessmentEngine;
  assert(engine && engine.schemaVersion === 1, 'The shared assessment engine did not initialize.');
  const normalizedOfficial = exams.map(exam => engine.normalizeAssessment({
    ...exam,
    questionImagePattern: 'assets/exams/{assessmentId}/q{number}.jpg'
  }, { courseId: 'social-culture', assessmentType: 'official-exam' }));
  assert(normalizedOfficial.length === 15, 'Expected 15 normalized official assessments.');
  for (const exam of normalizedOfficial) {
    assert(exam.questionCount === 20 && exam.items === exam.questions, 'Normalized assessment item count or item alias is invalid: ' + exam.id);
    for (const q of exam.questions) {
      assert(q.responseType === 'single-choice' && q.options.length === 5, 'Legacy image/OMR item was not normalized as five-choice single-choice: ' + exam.id + ' Q' + q.n);
      assert(q.answerKey === q.ans && Number.isInteger(q.answerKey) && q.answerKey >= 0 && q.answerKey <= 4, 'Legacy official answer key changed during normalization: ' + exam.id + ' Q' + q.n);
      assert(q.stimulus && q.stimulus.type === 'image' && q.stimulus.assets[0].indexOf('assets/exams/' + exam.id + '/') === 0, 'Official question image stimulus was not mapped: ' + exam.id + ' Q' + q.n);
    }
  }
  const normalizedPractice = predict.map(exam => engine.normalizeAssessment(exam, {
    courseId: 'social-culture',
    assessmentType: 'self-produced-practice'
  }));
  assert(normalizedPractice.length === 3 && normalizedPractice.reduce((sum, exam) => sum + exam.questionCount, 0) === 60,
    'Expected 60 normalized practice questions.');
  for (const exam of normalizedPractice) for (const q of exam.questions) {
    assert(q.responseType === 'single-choice' && q.options.length === 5 && q.answerKey === q.a && q.ans === q.a,
      'Legacy practice multiple-choice item was not normalized compatibly: ' + exam.id + ' Q' + q.n);
  }

  for (const assessment of normalizedOfficial.concat(normalizedPractice)) {
    const validation = engine.validateAssessment(assessment);
    assert(validation.valid, 'Assessment validation failed for ' + assessment.id + ': ' + validation.errors.join(', '));
  }

  const single = engine.normalizeQuestion({ id: 'single', responseType: 'single-choice', prompt: 'Pick', options: ['A', 'B'], answerKey: 1, points: 2 });
  const multi = engine.normalizeQuestion({ id: 'multi', responseType: 'multiple-select', prompt: 'Select', options: ['A', 'B', 'C'], answerKey: [0, 2], points: 3 });
  const short = engine.normalizeQuestion({ id: 'short', responseType: 'short-answer', prompt: 'Name', answerKey: ['Seoul', '서울'], points: 2 });
  const numeric = engine.normalizeQuestion({ id: 'numeric', responseType: 'numeric', prompt: 'Calculate', answerKey: { value: 3.14, tolerance: 0.01 }, points: 3 });
  const essay = engine.normalizeQuestion({ id: 'essay', responseType: 'essay', prompt: 'Explain', rubric: 'Concept accuracy and reasoning', points: 5 });
  const code = engine.normalizeQuestion({ id: 'code', responseType: 'code', prompt: 'Write code', testCases: [{ input: '1', expected: '1' }], points: 5 });
  assert(engine.evaluateResponse(single, 1).status === 'correct', 'Single-choice automatic grading failed.');
  assert(engine.evaluateResponse(multi, [2, 0]).status === 'correct', 'Multiple-select exact-set grading failed.');
  assert(engine.evaluateResponse(short, ' 서울 ').status === 'correct', 'Short-answer normalization/grading failed.');
  assert(engine.evaluateResponse(numeric, '3.145').status === 'correct', 'Numeric tolerance grading failed.');
  assert(engine.evaluateResponse(essay, 'written response').status === 'pending-manual', 'Essay response must remain pending manual grading.');
  assert(engine.evaluateResponse(code, 'console.log(1)').status === 'pending-manual', 'Code response must remain pending manual grading.');
  assert(engine.evaluateResponse(multi, []).status === 'unanswered', 'An empty multi-select response must be unanswered.');
  assert(engine.evaluateResponse(short, '   ').status === 'unanswered', 'A whitespace-only short answer must be unanswered.');
  assert(engine.evaluateResponse(essay, 'written response', { earnedPoints: 4 }).earnedPoints === 4, 'Manual rubric score handling failed.');
  assert(engine.evaluateResponse(essay, 'written response', { earnedPoints: 6 }).earnedPoints === 5, 'Manual rubric scores must be capped at the question maximum.');
  assert(engine.gradeAttempt([essay], ['written response'], { 0: { earnedPoints: 4 } }).earnedPoints === 4, 'Manual grading must be included in attempt totals.');
  const partialManual = engine.gradeAttempt([essay], ['written response'], { 0: { earnedPoints: 4 } });
  assert(partialManual.earnedPoints === 4 && partialManual.pendingManualCount === 0 && partialManual.correctCount === 0,
    'Partial manual grading must contribute points without counting as a fully correct response.');
  const fullManual = engine.gradeAttempt([essay], ['written response'], { 0: { earnedPoints: 5 } });
  assert(fullManual.earnedPoints === 5 && fullManual.correctCount === 1, 'Full manual grading must count as correct.');
  assert(engine.validateQuestion(essay).valid && engine.validateQuestion(code).valid, 'Manual-review configuration validation failed.');
  assert(engine.gradeAttempt([single, multi], [1, [0, 2]]).earnedPoints === 5, 'Generic attempt aggregation failed.');
  vm.runInContext(read('js/analytics.js'), context, { filename: 'js/analytics.js' });
  const analytics = context.window.StudyAnalytics;
  assert(analytics && typeof analytics.calculate === 'function', 'The learning analytics module did not initialize.');
  const analyticsExam = normalizedOfficial[0];
  const analyticsCorrectAnswers = analyticsExam.questions.map(question => question.answerKey);
  const analyticsWrongAnswers = analyticsCorrectAnswers.slice();
  const wrongIndex = 1;
  analyticsWrongAnswers[wrongIndex] = analyticsCorrectAnswers[wrongIndex] === 0 ? 1 : 0;
  const analyticsResult = analytics.calculate({
    courseId: 'social-culture',
    units: base.units,
    conceptQuestions: base.questions,
    exams: [analyticsExam],
    history: [
      { courseId: 'social-culture', id: analyticsExam.id, attemptId: 'analytics-a1', score: 40, max: 50, at: 1000 },
      { courseId: 'social-culture', id: analyticsExam.id, attemptId: 'analytics-a2', score: 35, max: 50, at: 2000 },
      { courseId: 'social-culture', id: analyticsExam.id, score: 30, max: 50, at: 3000 }
    ],
    snapshots: {
      ['social-culture:' + analyticsExam.id + ':analytics-a1']: {
        courseId: 'social-culture', examId: analyticsExam.id, attemptId: 'analytics-a1',
        answers: analyticsWrongAnswers, manualGrades: {}, excludedDiagram: false, submittedAt: 1000
      },
      ['social-culture:' + analyticsExam.id + ':analytics-a2']: {
        courseId: 'social-culture', examId: analyticsExam.id, attemptId: 'analytics-a2',
        answers: analyticsWrongAnswers, manualGrades: {}, excludedDiagram: false, submittedAt: 2000
      }
    },
    conceptStats: { total: 3, correct: 2, byUnit: { 1: { total: 3, correct: 2 } } },
    conceptWrong: { 2: 2 },
    engine
  });
  assert(analyticsResult.totalExamAttempts === 3 && analyticsResult.detailedAttempts === 2 &&
    analyticsResult.scoreOnlyAttempts === 1, 'Learning analytics must separate detailed attempts from score-only history.');
  assert(analyticsResult.examQuestionWeakness.some(item =>
    item.questionNumber === 2 && item.incorrectCount === 2),
    'Learning analytics must detect repeated wrong answers on the same exam question.');
  assert(analyticsResult.unitMetrics[0].accuracy === 67,
    'Learning analytics must calculate concept-unit accuracy from stored aggregate statistics.');
  assert(analyticsResult.unitQuestionCoverage === 0,
    'Learning analytics must not infer unit tags for unclassified mock exam questions.');
  return { exams, conceptQuestions: base.questions.length, predictQuestions: predict.reduce((sum, exam) => sum + exam.questions.length, 0) };
}

function validateRuntimeAssets(exams) {
  const cssPath = path.join(root, 'css/style.css');
  assert(fs.existsSync(cssPath), 'Missing css/style.css.');
  assert(fs.statSync(cssPath).size > 1000, 'css/style.css is unexpectedly small.');

  const pwaFiles = [
    'manifest.webmanifest', 'service-worker.js', 'assets/app-icon.svg',
    'assets/app-icon-192.png', 'assets/app-icon-512.png'
  ];
  for (const file of pwaFiles) {
    const absolute = path.join(root, file);
    assert(fs.existsSync(absolute), 'Missing PWA asset: ' + file);
    assert(fs.statSync(absolute).size > 100, 'PWA asset is unexpectedly small: ' + file);
  }

  const requiredScripts = [
    'courses/social-culture/content.js', 'courses/social-culture/assessments.js',
    'js/course-registry.js', 'js/data.js', 'js/exams.js', 'js/storage.js', 'js/predict.js',
    'js/assessment-engine.js', 'js/game.js', 'js/pen-tools.js', 'js/exam-app.js', 'js/analytics.js', 'js/app.js'
  ];
  for (const file of requiredScripts) {
    const absolute = path.join(root, file);
    assert(fs.existsSync(absolute), 'Missing runtime script: ' + file);
    assert(fs.statSync(absolute).size > 100, 'Runtime script is unexpectedly small: ' + file);
  }

  let count = 0;
  let bytes = 0;
  for (const exam of exams) for (let n = 1; n <= 20; n += 1) {
    const filename = 'q' + String(n).padStart(2, '0') + '.jpg';
    const relative = path.join('assets', 'exams', exam.id, filename);
    const absolute = path.join(root, relative);
    assert(fs.existsSync(absolute), 'Missing exam image: ' + relative);
    const stat = fs.statSync(absolute);
    assert(stat.size > 1000, 'Exam image is empty or truncated: ' + relative);
    const fd = fs.openSync(absolute, 'r');
    const head = Buffer.alloc(2);
    const tail = Buffer.alloc(2);
    try {
      fs.readSync(fd, head, 0, 2, 0);
      fs.readSync(fd, tail, 0, 2, stat.size - 2);
    } finally {
      fs.closeSync(fd);
    }
    assert(head[0] === 0xff && head[1] === 0xd8 && tail[0] === 0xff && tail[1] === 0xd9,
      'Exam image is not a complete JPEG: ' + relative);
    bytes += stat.size;
    count += 1;
  }
  assert(count === 300, 'Expected 300 exam images; found ' + count + '.');
  return { count, bytes };
}

function main() {
  const nomedia = path.join(root, 'assets', '.nomedia');
  assert(fs.existsSync(nomedia) && fs.statSync(nomedia).size === 0,
    'Missing empty assets/.nomedia; Android Gallery may index the exam JPG files.');

  let html = read('app-source.html');
  const examApp = read('js/exam-app.js');
  assert(!html.includes('data-pplx-inline-edit'), 'Unexpected editor-injected script in app-source.html.');
  assert(html.includes('id="view-subject-select"'), 'The first-visit subject selection view is missing.');
  const assessmentLoadOrder = [
    'src="courses/social-culture/assessments.js"',
    'src="js/exams.js"',
    'src="js/predict.js"',
    'src="js/assessment-engine.js"',
    'src="js/exam-app.js?v=20261117-attempt-history-1"',
    'src="js/analytics.js?v=20261117-learning-analytics-1"',
    'src="js/app.js"'
  ].map(ref => html.indexOf(ref));
  assert(assessmentLoadOrder.every(position => position >= 0) &&
    assessmentLoadOrder.every((position, index) => index === 0 || position > assessmentLoadOrder[index - 1]),
    'Course assessments and assessment engine scripts must load before the exam UI.');
  assert(html.includes('<link rel="manifest" href="manifest.webmanifest?v=20261116-name-2" />'), 'The PWA manifest link is missing.');
  assert(html.includes("navigator.serviceWorker.register('./service-worker.js'"), 'The PWA service worker registration is missing.');

  const dataCheck = validateQuestionData();
  const assetCheck = validateRuntimeAssets(dataCheck.exams);

  assert(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']css\/style\.css["'][^>]*>/i.test(html),
    'The source template must load the local css/style.css file.');
  for (const file of ['courses/social-culture/content.js', 'courses/social-culture/assessments.js', 'js/course-registry.js', 'js/data.js', 'js/exams.js', 'js/storage.js', 'js/predict.js', 'js/assessment-engine.js', 'js/game.js', 'js/pen-tools.js', 'js/exam-app.js', 'js/app.js']) {
    const scriptRef = file === 'js/pen-tools.js'
      ? 'src="js/pen-tools.js?v=20261117-ai-report-1"'
      : (file === 'js/exam-app.js'
        ? 'src="js/exam-app.js?v=20261117-attempt-history-1"'
        : (file === 'js/analytics.js'
          ? 'src="js/analytics.js?v=20261117-learning-analytics-1"'
          : 'src="' + file + '"'));
    assert(html.includes(scriptRef), 'The source template is missing ' + file + '.');
  }
  assert(examApp.includes("return 'assets/exams/'"),
    'The exam renderer must use ordinary relative exam-image paths.');
  assert(examApp.includes('data-manual-save') && examApp.includes('data-manual-score') && examApp.includes('study_manual_grades_v1'),
    'The exam UI must expose persisted manual grading controls for essay/code responses.');
  assert(examApp.includes('study_exam_attempts_v1') && examApp.includes('saveAttemptSnapshot'),
    'Exam submissions must persist full attempt snapshots.');
  assert(examApp.includes('data-open-attempt') && examApp.includes('function openAttempt'),
    'The exam picker must reopen saved attempts for review and grading edits.');
  const analyticsSource = read('js/analytics.js');
  assert(analyticsSource.includes('function calculate(options)') && analyticsSource.includes('unitQuestionCoverage'),
    'The learning analytics calculation module is missing its testable model or classification coverage check.');
  assert(fs.existsSync(path.join(root, 'service-worker.js')) && read('service-worker.js').includes('social-culture-study-shell-v12'),
    'The service worker cache must be advanced for the learning analytics module.');
  assert(!/https?:\/\//i.test(html.replace(/<link rel="icon" href="data:image\/svg\+xml,[^"]*"/, '')),
    'The runtime template must not depend on an external URL.');

  html = html.replace('<title>사회문화 연습장 — 수능 개념 문제 연습</title>', '<title>사회문화 연습장</title>');
  html = html.replace('<meta name="description"', '<meta name="app-runtime" content="local-static-files-no-network-api" />\n<meta name="description"');
  assert(Buffer.byteLength(html, 'utf8') < 100000, 'The shared entrypoint must stay below 100 KB.');
  write('index.html', html);

  console.log('Built lightweight index.html: ' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KiB.');
  console.log('Validated 5 units, ' + dataCheck.conceptQuestions + ' concept questions, ' +
    dataCheck.exams.length + ' official sessions / 300 answer records, and ' + dataCheck.predictQuestions + ' self-made questions.');
  console.log('Validated ' + assetCheck.count + ' JPEG files (' + (assetCheck.bytes / 1024 / 1024).toFixed(2) + ' MiB total) without embedding them into HTML.');
  console.log('Runtime uses local relative CSS/JS/image files; pen drawing and storage remain device-local.');
}

main();
