/* 학습노트 — 과목/평가 체계 레지스트리
   새 과목은 이 파일에 데이터 정의를 추가하고, 실제 콘텐츠 모듈을 연결한 뒤 공개합니다.
   아직 콘텐츠가 없는 과목은 available 상태로 등록하지 않습니다. */
(function (global) {
  'use strict';

  var courses = [
    {
      id: 'social-culture',
      title: '사회·문화',
      symbol: '社',
      status: 'available',
      contentKey: 'social-culture',
      educationStage: 'high-school',
      discipline: 'social-sciences',
      courseKind: 'elective',
      curriculum: {
        name: '2015 개정 교육과정',
        version: '2015'
      },
      description: '사회·문화 핵심 개념과 평가원 기출을 학습합니다.',
      detail: '5개 단원 · 개념 문제 62문항 · 기출 15회분',
      content: {
        unitCount: 5,
        conceptQuestionCount: 62,
        officialAssessmentSessions: 15,
        practiceAssessmentSessions: 3
      },
      home: {
        kicker: '2015 개정 교육과정 · 사회·문화',
        heading: ['단원을 골라 개념 문제로', '수능 감각을 연습하세요'],
        description: '수능·평가원 기출 출제 경향을 반영해 제작한 개념 문제',
        examBannerLabel: '평가원 기출 5개년 · 15회분 (수능·6월·9월)',
        unitSectionLabel: '단원 선택',
        unitSectionSubtitle: '2015 개정 교육과정 사회·문화'
      },
      assessmentProfiles: [
        {
          id: 'official-mock',
          type: 'official-exam',
          label: '평가원 기출',
          durationSec: 1800,
          questionCount: 20,
          choiceCount: 5,
          pointValues: [2, 3],
          maxScore: 50,
          sessionKinds: ['suneung', 'june', 'sept']
        },
        {
          id: 'predict-mock',
          type: 'self-produced-practice',
          label: '수능 예상 모의고사',
          durationSec: 1800,
          questionCount: 20,
          choiceCount: 5,
          pointValues: [2, 3],
          maxScore: 50,
          idPrefix: 'predict_'
        }
      ]
    }
  ];

  function get(id) {
    return courses.filter(function (course) { return course.id === id; })[0] || null;
  }

  function listAvailable() {
    return courses.filter(function (course) { return course.status === 'available'; }).slice();
  }

  function getContent(courseId) {
    var course = get(courseId);
    if (!course || !course.contentKey) return null;
    var modules = global.StudyCourseContent;
    return modules && modules[course.contentKey] ? modules[course.contentKey] : null;
  }

  function getAssessmentProfile(courseId, profileId) {
    var course = get(courseId);
    if (!course || !Array.isArray(course.assessmentProfiles)) return null;
    return course.assessmentProfiles.filter(function (profile) {
      return profile.id === profileId;
    })[0] || null;
  }

  function findAssessmentProfileForExam(exam) {
    if (!exam) return null;
    var match = null;
    courses.some(function (course) {
      (course.assessmentProfiles || []).some(function (profile) {
        var prefixMatch = profile.idPrefix && String(exam.id || '').indexOf(profile.idPrefix) === 0;
        var kindMatch = Array.isArray(profile.sessionKinds) && profile.sessionKinds.indexOf(exam.kind) !== -1;
        if (prefixMatch || kindMatch) {
          match = { course: course, profile: profile };
          return true;
        }
        return false;
      });
      return match !== null;
    });
    return match;
  }

  global.StudyCourseRegistry = {
    version: 1,
    get: get,
    listAvailable: listAvailable,
    getContent: getContent,
    getAssessmentProfile: getAssessmentProfile,
    findAssessmentProfileForExam: findAssessmentProfileForExam
  };
})(window);
