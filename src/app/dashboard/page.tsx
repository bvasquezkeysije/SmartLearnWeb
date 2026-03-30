"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  MouseEvent,
  ReactNode,
  TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SessionUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  roles: string[];
  token: string;
  authProvider?: string | null;
  hasLocalPassword?: boolean | null;
  profileImageData?: string | null;
  profileImageScale?: number | null;
  profileImageOffsetX?: number | null;
  profileImageOffsetY?: number | null;
};

type ProfileImageSyncResponse = {
  token?: string | null;
  profileImageData?: string | null;
  profileImageScale?: number | null;
  profileImageOffsetX?: number | null;
  profileImageOffsetY?: number | null;
};

type MenuItem = {
  key: string;
  label: string;
};

type ExamSummary = {
  id: number;
  name: string;
  code?: string | null;
  sourceFilePath?: string | null;
  questionsCount?: number | null;
  personalPracticeCount?: number | null;
  groupPracticeCount?: number | null;
  attemptsCount?: number | null;
  practiceFeedbackEnabled?: boolean | null;
  practiceOrderMode?: string | null;
  practiceRepeatUntilCorrect?: boolean | null;
  ownerUserId?: number | null;
  visibility?: "public" | "private" | string | null;
  accessRole?: "owner" | "editor" | "viewer" | string | null;
  canEditQuestions?: boolean | null;
  canEditSettings?: boolean | null;
  canShare?: boolean | null;
  canStartGroup?: boolean | null;
  canRenameExam?: boolean | null;
  participantsCount?: number | null;
  groupPracticeSessionId?: number | null;
  groupPracticeStatus?: "waiting" | "active" | "finished" | string | null;
  groupPracticeCreatedByUserId?: number | null;
  createdAt?: unknown;
  created_at?: unknown;
};

type ExamParticipant = {
  userId: number;
  name: string;
  username: string;
  email: string;
  profileImageUrl?: string | null;
  role: "owner" | "editor" | "viewer" | string;
  canShare?: boolean | null;
  canStartGroup?: boolean | null;
  canRenameExam?: boolean | null;
  owner?: boolean | null;
  joinedAt?: unknown;
};

type ExamQuestion = {
  id: number;
  examId: number;
  questionText: string;
  questionType: string;
  correctAnswer?: string | null;
  explanation?: string | null;
  points?: number | null;
  temporizadorSegundos?: number | null;
  reviewSeconds?: number | null;
  timerEnabled?: boolean | null;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  correctOption?: string | null;
};

type ExamGroupParticipantState = {
  userId: number;
  name: string;
  username: string;
  profileImageUrl?: string | null;
  role: string;
  canStartGroup?: boolean | null;
  owner?: boolean | null;
  connected?: boolean | null;
  answeredCurrent?: boolean | null;
  correctCurrent?: boolean | null;
};

type ExamGroupCurrentAnswer = {
  userId: number;
  name: string;
  username: string;
  profileImageUrl?: string | null;
  selectedAnswer?: string | null;
  selectedOptionKey?: "a" | "b" | "c" | "d" | null;
  correct?: boolean | null;
  answeredAt?: unknown;
};

type ExamGroupRankingEntry = {
  rank: number;
  userId: number;
  name: string;
  username: string;
  profileImageUrl?: string | null;
  correctCount?: number | null;
  wrongCount?: number | null;
  baseScore?: number | null;
  speedBonus?: number | null;
  finalScore?: number | null;
};

type ExamGroupState = {
  sessionId: number;
  examId: number;
  examName: string;
  status: "waiting" | "active" | "finished" | string;
  totalQuestions: number;
  currentQuestionIndex: number;
  allAnsweredCurrent?: boolean | null;
  canStartGroup?: boolean | null;
  currentQuestion?: ExamQuestion | null;
  currentAnswers?: ExamGroupCurrentAnswer[];
  participants: ExamGroupParticipantState[];
  finalRanking?: ExamGroupRankingEntry[];
  firstResponderName?: string | null;
  firstAnswerElapsedSeconds?: number | null;
  questionStartedAt?: string | null;
  questionStartedAtEpochMs?: number | null;
  startedAt?: unknown;
  finishedAt?: unknown;
};

const buildGroupQuestionKey = (state: ExamGroupState | null): string | null => {
  if (!state || state.status !== "active" || !state.currentQuestion) {
    return null;
  }
  return `${state.sessionId}:${state.currentQuestionIndex}:${state.currentQuestion.id}`;
};

const normalizeGroupUserKey = (value: unknown): string => String(value ?? "").trim();
const isUserActive = (status: unknown): boolean => Number(status) === 1;

const toMillisOrZero = (value: unknown): number => {
  if (!value) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeGroupAnswers = (
  previousAnswers: ExamGroupCurrentAnswer[] | undefined,
  incomingAnswers: ExamGroupCurrentAnswer[] | undefined,
): ExamGroupCurrentAnswer[] => {
  const mergedByUser = new Map<string, ExamGroupCurrentAnswer>();

  const upsert = (answer: ExamGroupCurrentAnswer) => {
    const key = normalizeGroupUserKey(answer.userId);
    if (!key) {
      return;
    }
    const existing = mergedByUser.get(key);
    if (!existing) {
      mergedByUser.set(key, answer);
      return;
    }

    const incomingText = (answer.selectedAnswer ?? "").trim();
    const existingText = (existing.selectedAnswer ?? "").trim();
    const incomingAt = toMillisOrZero(answer.answeredAt);
    const existingAt = toMillisOrZero(existing.answeredAt);
    const incomingWins = incomingAt >= existingAt;

    mergedByUser.set(key, {
      ...(incomingWins ? existing : answer),
      ...(incomingWins ? answer : existing),
      selectedAnswer: incomingText || existingText,
    });
  };

  for (const answer of previousAnswers ?? []) {
    upsert(answer);
  }
  for (const answer of incomingAnswers ?? []) {
    upsert(answer);
  }

  return Array.from(mergedByUser.values());
};

const mergeGroupState = (previous: ExamGroupState | null, incoming: ExamGroupState): ExamGroupState => {
  if (!previous) {
    return incoming;
  }
  if (previous.sessionId !== incoming.sessionId) {
    return incoming;
  }

  const previousStatus = (previous.status ?? "").toLowerCase();
  const incomingStatus = (incoming.status ?? "").toLowerCase();
  const previousIndex = previous.currentQuestionIndex ?? 0;
  const incomingIndex = incoming.currentQuestionIndex ?? 0;

  // Ignorar snapshots tardíos que regresan a una pregunta anterior.
  if (previousStatus === "active" && incomingStatus === "active" && incomingIndex < previousIndex) {
    return previous;
  }

  const sameQuestion =
    previousStatus === "active" &&
    incomingStatus === "active" &&
    previous.currentQuestion?.id != null &&
    incoming.currentQuestion?.id != null &&
    previous.currentQuestion.id === incoming.currentQuestion.id &&
    previousIndex === incomingIndex;

  const mergedAnswers = sameQuestion
    ? mergeGroupAnswers(previous.currentAnswers, incoming.currentAnswers)
    : (incoming.currentAnswers ?? []);

  const mergedParticipants = incoming.participants.map((participant) => {
    const participantKey = normalizeGroupUserKey(participant.userId);
    const previousParticipant = previous.participants.find(
      (item) => normalizeGroupUserKey(item.userId) === participantKey,
    );
    if (!previousParticipant) {
      return participant;
    }

    if (!sameQuestion) {
      return participant;
    }

    return {
      ...participant,
      answeredCurrent: Boolean(participant.answeredCurrent) || Boolean(previousParticipant.answeredCurrent),
      correctCurrent:
        participant.correctCurrent != null
          ? participant.correctCurrent
          : previousParticipant.correctCurrent,
    };
  });

  return {
    ...incoming,
    participants: mergedParticipants,
    currentAnswers: mergedAnswers,
  };
};

type CourseExamItem = {
  id: number;
  name: string;
  questionsCount?: number | null;
};

type CourseParticipantItem = {
  id?: number | null;
  userId: number;
  name: string;
  username: string;
  email: string;
  role?: string | null;
  owner?: boolean | null;
  joinedAt?: unknown;
};

type CourseGradeItem = {
  userId: number;
  name: string;
  username: string;
  email: string;
  attemptsCount?: number | null;
  averageScore?: number | null;
  bestScore?: number | null;
  lastScore?: number | null;
  lastAttemptAt?: unknown;
};

type CourseCompetencyItem = {
  id: number;
  name: string;
  description?: string | null;
  level?: string | null;
  sortOrder?: number | null;
  createdAt?: unknown;
};

type CourseSessionContentItem = {
  id: number;
  type?: string | null;
  title?: string | null;
  externalLink?: string | null;
  fileName?: string | null;
  fileData?: string | null;
  sourceExamId?: number | null;
  sourceExamName?: string | null;
  createdAt?: unknown;
};

type CourseSessionContentPracticeStartResponse = {
  examId: number;
  examName: string;
};

type CourseSessionItem = {
  id: number;
  name: string;
  weeklyContent?: string | null;
  contents?: CourseSessionContentItem[];
  createdAt?: unknown;
};

type CourseItem = {
  id: number;
  name: string;
  description?: string | null;
  coverImageData?: string | null;
  code?: string | null;
  visibility?: "public" | "private" | null;
  priority?: "very_important" | "important" | "low_important" | "optional" | null;
  sortOrder?: number | null;
  ownerUserId?: number | null;
  sessions?: CourseSessionItem[];
  exams: CourseExamItem[];
  participants?: CourseParticipantItem[];
  grades?: CourseGradeItem[];
  competencies?: CourseCompetencyItem[];
  createdAt?: unknown;
};

type CourseModulePayload = {
  courses: CourseItem[];
  availableExams: CourseExamItem[];
};

function countCourseExams(course: CourseItem): number {
  const examIds = new Set<number>();
  let examContentsWithoutId = 0;

  (course.sessions ?? []).forEach((session) => {
    (session.contents ?? []).forEach((content) => {
      const contentType = (content.type ?? "").toLowerCase();
      if (contentType !== "exam" && contentType !== "examen") {
        return;
      }
      if (typeof content.sourceExamId === "number" && Number.isFinite(content.sourceExamId)) {
        examIds.add(content.sourceExamId);
      } else {
        examContentsWithoutId += 1;
      }
    });
  });

  return examIds.size + examContentsWithoutId;
}

type ChatSummary = {
  id: number;
  name: string;
  messagesCount?: number;
  createdAt?: unknown;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | string;
  content: string;
  createdAt?: unknown;
};

type ChatDetail = {
  id: number;
  name: string;
  messages: ChatMessage[];
};

type ChatGenerateExamResult = {
  examId: number;
  examName: string;
  questionsCount: number;
  chat: ChatDetail;
};

type IaModelsResponse = {
  defaultModel?: string;
  models?: string[];
};

type SalaParticipant = {
  id: number;
  name: string;
  micOn: boolean;
  isScreenSharing?: boolean;
};

type SalaMessage = {
  id: number;
  sender: string;
  content: string;
  isCurrentUser: boolean;
};

type SalaItem = {
  id: number;
  name: string;
  code: string;
  visibility: "public" | "private";
  description: string;
  imageData?: string | null;
  ownerUserId?: number | null;
  accessRole?: "owner" | "editor" | "viewer" | string;
  canEdit?: boolean;
  canShare?: boolean;
  createdAt?: unknown;
  participants: SalaParticipant[];
  messages: SalaMessage[];
};

type SalaModulePayload = {
  salas: SalaItem[];
  selectedSalaId?: number | null;
};

type ScheduleDayKey = "all" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
type ScheduleColorKey = "blue" | "emerald" | "amber" | "violet" | "rose";
type ScheduleActivity = {
  id: number;
  title: string;
  description: string;
  day: ScheduleDayKey;
  startTime: string;
  endTime: string;
  location: string;
  color: ScheduleColorKey;
};

type ScheduleProfileOption = {
  profileId: number;
  profileName: string;
  ownerUserId?: number | null;
  ownerName?: string | null;
  accessRole?: "owner" | "editor" | "viewer" | string | null;
  canEdit?: boolean | null;
  canShare?: boolean | null;
  createdAt?: unknown;
};

type ScheduleModulePayload = {
  profileId: number;
  profileName: string;
  description?: string | null;
  ownerUserId?: number | null;
  accessRole?: "owner" | "editor" | "viewer" | string | null;
  canEdit?: boolean | null;
  canShare?: boolean | null;
  profiles: ScheduleProfileOption[];
  referenceImageData?: string | null;
  referenceImageName?: string | null;
  activities: ScheduleActivity[];
  createdAt?: unknown;
};

type ShareLinkResponse = {
  id: number;
  resourceType: "exam" | "course" | "schedule" | "sala" | string;
  resourceId: number;
  token: string;
  expiresAt?: unknown;
  claimsCount?: number;
};

type ShareLinkClaimResponse = {
  resourceType: "exam" | "course" | "schedule" | "sala" | string;
  resourceId: number;
  resourceName?: string | null;
  message?: string | null;
};

type ShareResourceType = "exam" | "course" | "sala" | "schedule";

type ShareRecipient = {
  id: number;
  name: string;
  username: string;
  email: string;
};

type ShareNotificationItem = {
  id: number;
  senderUserId?: number | null;
  senderName?: string | null;
  senderUsername?: string | null;
  resourceType: ShareResourceType | string;
  resourceId: number;
  resourceName?: string | null;
  message?: string | null;
  token?: string | null;
  invitationStatus?: "pending" | "accepted" | "rejected" | string | null;
  invitationRespondedAt?: unknown;
  readAt?: unknown;
  createdAt?: unknown;
};

type ShareDistributeResponse = {
  shareLinkId: number;
  resourceType: ShareResourceType | string;
  resourceId: number;
  token: string;
  expiresAt?: unknown;
  notificationsCreated?: number;
};

type SupportConversationItem = {
  id: number;
  requesterUserId: number;
  requesterName: string;
  requesterUsername?: string | null;
  assignedAdminUserId?: number | null;
  assignedAdminName?: string | null;
  subject: string;
  status: string;
  priority: string;
  channelPreference: string;
  whatsappNumber?: string | null;
  callNumber?: string | null;
  lastMessageAt?: unknown;
  createdAt?: unknown;
};

type SupportMessageItem = {
  id: number;
  conversationId: number;
  senderUserId?: number | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderRole?: string | null;
  content: string;
  createdAt?: unknown;
};

type SupportCallRequestItem = {
  id: number;
  requesterUserId?: number | null;
  requesterName?: string | null;
  requesterUsername?: string | null;
  phoneNumber: string;
  preferredSchedule?: string | null;
  reason: string;
  status: string;
  handledByAdminUserId?: number | null;
  handledAt?: unknown;
  createdAt?: unknown;
};

type SupportModulePayload = {
  conversations: SupportConversationItem[];
  adminQueue: SupportConversationItem[];
  callRequests: SupportCallRequestItem[];
  adminView: boolean;
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_EXPIRED_EVENT_NAME = "smartlearn:session-expired";
const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 45 * 1000;
const SESSION_INACTIVITY_TIMEOUT_LABEL =
  SESSION_INACTIVITY_TIMEOUT_MS < 60 * 1000
    ? `${Math.max(1, Math.floor(SESSION_INACTIVITY_TIMEOUT_MS / 1000))} segundos`
    : `${Math.max(1, Math.floor(SESSION_INACTIVITY_TIMEOUT_MS / 60000))} minutos`;

type AdminUserRow = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  name: string;
  username: string;
  email: string;
  status: number;
  online?: boolean | null;
  lastSeenAt?: string | null;
  roles?: string[] | null;
};

type AdminRoleRow = {
  id: number;
  name: string;
  permissions: string[];
};

type RoleManagementPayload = {
  roles: AdminRoleRow[];
  availablePermissions: string[];
};

type PracticeStatus = "correct" | "incorrect" | "unanswered";

type PracticeFeedbackMode = "with_feedback" | "without_feedback";
type PracticeOrderMode = "ordered" | "random";
type PracticeProgressMode = "repeat_until_correct" | "allow_incorrect_pass";

type PracticeSettingsPayload = {
  practiceFeedbackMode: PracticeFeedbackMode;
  practiceOrderMode: PracticeOrderMode;
  practiceProgressMode: PracticeProgressMode;
};

type PracticeDraft = {
  examId: number;
  questionIds: number[];
  currentIndex: number;
  results: Record<number, PracticeStatus>;
  startedAt: number;
};

type ManualQuestionFormState = {
  questionText: string;
  questionType: "multiple_choice" | "written";
  correctAnswer: string;
  explanation: string;
  points: string;
  temporizadorSegundos: string;
  reviewSeconds: string;
  timerEnabled: boolean;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: "a" | "b" | "c" | "d";
};

function createEmptyManualQuestionForm(): ManualQuestionFormState {
  return {
    questionText: "",
    questionType: "multiple_choice",
    correctAnswer: "",
    explanation: "",
    points: "1",
    temporizadorSegundos: "30",
    reviewSeconds: "10",
    timerEnabled: true,
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    correctOption: "a",
  };
}

function createInitialSalaItems(): SalaItem[] {
  return [
    {
      id: 1,
      name: "SALA MATEMATICA",
      code: "SALA-MAT-001",
      visibility: "public",
      description: "Resolucion grupal de ejercicios y examen practico",
      participants: [
        { id: 1, name: "Ana", micOn: true, isScreenSharing: true },
        { id: 2, name: "Luis", micOn: false, isScreenSharing: true },
        { id: 3, name: "Valeria", micOn: true, isScreenSharing: true },
        { id: 4, name: "Tu", micOn: false, isScreenSharing: true },
        { id: 12, name: "Bruno", micOn: false, isScreenSharing: true },
        { id: 13, name: "Carla", micOn: true, isScreenSharing: true },
        { id: 14, name: "Jorge", micOn: false, isScreenSharing: true },
        { id: 15, name: "Lucero", micOn: true, isScreenSharing: true },
        { id: 16, name: "Mateo", micOn: false, isScreenSharing: false },
        { id: 17, name: "Renata", micOn: false, isScreenSharing: false },
        { id: 31, name: "Sebastian", micOn: true, isScreenSharing: false },
        { id: 32, name: "Mariana", micOn: false, isScreenSharing: false },
        { id: 33, name: "Pablo", micOn: false, isScreenSharing: false },
        { id: 34, name: "Daniela", micOn: true, isScreenSharing: false },
        { id: 35, name: "Andres", micOn: false, isScreenSharing: false },
        { id: 46, name: "Erika", micOn: false, isScreenSharing: false },
        { id: 47, name: "Fernando", micOn: true, isScreenSharing: false },
        { id: 48, name: "Gloria", micOn: false, isScreenSharing: false },
        { id: 49, name: "Hugo", micOn: false, isScreenSharing: false },
        { id: 50, name: "Isabel", micOn: true, isScreenSharing: false },
        { id: 51, name: "Julio", micOn: false, isScreenSharing: false },
        { id: 52, name: "Karen", micOn: false, isScreenSharing: false },
        { id: 53, name: "Luz", micOn: true, isScreenSharing: false },
        { id: 54, name: "Martin", micOn: false, isScreenSharing: false },
        { id: 55, name: "Nora", micOn: false, isScreenSharing: false },
        { id: 56, name: "Omar", micOn: true, isScreenSharing: false },
        { id: 57, name: "Paola", micOn: false, isScreenSharing: false },
        { id: 58, name: "Quino", micOn: false, isScreenSharing: false },
        { id: 59, name: "Rocio", micOn: true, isScreenSharing: false },
        { id: 60, name: "Sergio", micOn: false, isScreenSharing: false },
      ],
      messages: [
        { id: 101, sender: "Ana", content: "Estoy compartiendo pantalla con la resolucion de la pregunta 4.", isCurrentUser: false },
        { id: 102, sender: "Valeria", content: "Yo tengo el microfono activo para explicar el procedimiento.", isCurrentUser: false },
        { id: 103, sender: "Tu", content: "Perfecto, los sigo y voy tomando notas.", isCurrentUser: true },
        { id: 104, sender: "Luis", content: "Ya resolvi el inciso 2, revisen si coincide.", isCurrentUser: false },
        { id: 105, sender: "Tu", content: "En un minuto lo comparo con mi resultado.", isCurrentUser: true },
        { id: 106, sender: "Ana", content: "Voy a pasar a la pregunta 5 en la pantalla.", isCurrentUser: false },
        { id: 107, sender: "Bruno", content: "Compartan el procedimiento completo para copiarlo en limpio.", isCurrentUser: false },
        { id: 108, sender: "Tu", content: "Listo, ya anote la formula y el reemplazo.", isCurrentUser: true },
        { id: 109, sender: "Valeria", content: "Recuerden verificar unidades antes del resultado final.", isCurrentUser: false },
        { id: 110, sender: "Carla", content: "Estoy resolviendo el mismo problema en paralelo.", isCurrentUser: false },
        { id: 111, sender: "Tu", content: "Cuando termines compara con el metodo de Ana.", isCurrentUser: true },
        { id: 112, sender: "Ana", content: "Cierro esta parte y abrimos dudas sueltas.", isCurrentUser: false },
        { id: 113, sender: "Tu", content: "Perfecto, me quedo en la sala para continuar.", isCurrentUser: true },
      ],
    },
    {
      id: 2,
      name: "SALA HISTORIA",
      code: "SALA-HIS-001",
      visibility: "private",
      description: "Repaso intensivo por bloques del temario",
      participants: [
        { id: 5, name: "Marco", micOn: true, isScreenSharing: false },
        { id: 6, name: "Sofia", micOn: true, isScreenSharing: false },
        { id: 7, name: "Tu", micOn: false, isScreenSharing: false },
        { id: 18, name: "Alvaro", micOn: false, isScreenSharing: false },
        { id: 19, name: "Camila", micOn: true, isScreenSharing: false },
        { id: 20, name: "Diego", micOn: false, isScreenSharing: false },
        { id: 21, name: "Elena", micOn: false, isScreenSharing: false },
        { id: 22, name: "Fabian", micOn: true, isScreenSharing: false },
        { id: 23, name: "Gabriela", micOn: false, isScreenSharing: false },
        { id: 24, name: "Hector", micOn: false, isScreenSharing: false },
        { id: 36, name: "Irene", micOn: true, isScreenSharing: false },
        { id: 37, name: "Joaquin", micOn: false, isScreenSharing: false },
        { id: 38, name: "Kiara", micOn: false, isScreenSharing: false },
        { id: 39, name: "Leon", micOn: true, isScreenSharing: false },
        { id: 40, name: "Mia", micOn: false, isScreenSharing: false },
      ],
      messages: [
        { id: 201, sender: "Marco", content: "Repasemos cronologicamente para no mezclar periodos.", isCurrentUser: false },
        { id: 202, sender: "Tu", content: "De acuerdo, empecemos por la primera unidad.", isCurrentUser: true },
        { id: 203, sender: "Sofia", content: "Yo cubro la parte de antecedentes.", isCurrentUser: false },
        { id: 204, sender: "Tu", content: "Genial, yo tomo notas de fechas clave.", isCurrentUser: true },
        { id: 205, sender: "Marco", content: "Despues vemos causas y consecuencias.", isCurrentUser: false },
        { id: 206, sender: "Camila", content: "Comparto un resumen breve en un momento.", isCurrentUser: false },
        { id: 207, sender: "Tu", content: "Perfecto, asi cerramos el bloque completo.", isCurrentUser: true },
        { id: 208, sender: "Sofia", content: "No olviden los personajes principales.", isCurrentUser: false },
        { id: 209, sender: "Tu", content: "Anotado, los repaso antes del simulacro.", isCurrentUser: true },
        { id: 210, sender: "Marco", content: "Seguimos con la segunda unidad ahora.", isCurrentUser: false },
      ],
    },
    {
      id: 3,
      name: "SALA PROGRAMACION",
      code: "SALA-PRO-001",
      visibility: "public",
      description: "Dudas rapidas y correccion de ejercicios",
      participants: [
        { id: 8, name: "Diego", micOn: true, isScreenSharing: true },
        { id: 9, name: "Lucia", micOn: false, isScreenSharing: false },
        { id: 10, name: "Tu", micOn: false, isScreenSharing: false },
        { id: 11, name: "Camila", micOn: false, isScreenSharing: false },
        { id: 25, name: "Nadia", micOn: true, isScreenSharing: false },
        { id: 26, name: "Oscar", micOn: false, isScreenSharing: false },
        { id: 27, name: "Piero", micOn: false, isScreenSharing: false },
        { id: 28, name: "Raul", micOn: true, isScreenSharing: false },
        { id: 29, name: "Sandra", micOn: false, isScreenSharing: false },
        { id: 30, name: "Tatiana", micOn: false, isScreenSharing: false },
        { id: 41, name: "Uriel", micOn: true, isScreenSharing: false },
        { id: 42, name: "Viviana", micOn: false, isScreenSharing: false },
        { id: 43, name: "Walter", micOn: false, isScreenSharing: false },
        { id: 44, name: "Ximena", micOn: true, isScreenSharing: false },
        { id: 45, name: "Yahir", micOn: false, isScreenSharing: false },
      ],
      messages: [
        { id: 301, sender: "Diego", content: "Voy a mostrar la solucion del laboratorio en pantalla.", isCurrentUser: false },
        { id: 302, sender: "Tu", content: "Perfecto, inicio con la parte de validaciones.", isCurrentUser: true },
        { id: 303, sender: "Lucia", content: "A mi me falla el caso borde en el endpoint.", isCurrentUser: false },
        { id: 304, sender: "Diego", content: "Revisa null checks y orden de condiciones.", isCurrentUser: false },
        { id: 305, sender: "Tu", content: "Ya lo corrijo y les paso el diff.", isCurrentUser: true },
        { id: 306, sender: "Camila", content: "Compartan tambien la version final del algoritmo.", isCurrentUser: false },
        { id: 307, sender: "Tu", content: "Listo, lo subo con comentarios claros.", isCurrentUser: true },
        { id: 308, sender: "Nadia", content: "Me sumo para revisar complejidad y estilo.", isCurrentUser: false },
        { id: 309, sender: "Diego", content: "Cerramos esta parte en 10 minutos.", isCurrentUser: false },
        { id: 310, sender: "Tu", content: "Ok, quedo atento para la revision final.", isCurrentUser: true },
      ],
    },
  ];
}

const SCHEDULE_DAY_OPTIONS: Array<{ key: Exclude<ScheduleDayKey, "all">; label: string }> = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miercoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
  { key: "saturday", label: "Sabado" },
  { key: "sunday", label: "Domingo" },
];

const SCHEDULE_COLOR_OPTIONS: Array<{
  key: ScheduleColorKey;
  label: string;
  bg: string;
  border: string;
  text: string;
}> = [
  { key: "blue", label: "Azul", bg: "bg-blue-100", border: "border-blue-200", text: "text-blue-900" },
  { key: "emerald", label: "Verde", bg: "bg-emerald-100", border: "border-emerald-200", text: "text-emerald-900" },
  { key: "amber", label: "Amarillo", bg: "bg-amber-100", border: "border-amber-200", text: "text-amber-900" },
  { key: "violet", label: "Violeta", bg: "bg-violet-100", border: "border-violet-200", text: "text-violet-900" },
  { key: "rose", label: "Rosado", bg: "bg-rose-100", border: "border-rose-200", text: "text-rose-900" },
];

function scheduleColorClasses(color: ScheduleColorKey) {
  return SCHEDULE_COLOR_OPTIONS.find((option) => option.key === color) ?? SCHEDULE_COLOR_OPTIONS[0];
}

function normalizeScheduleDayKey(value: unknown): ScheduleDayKey {
  if (value === "all") {
    return "all";
  }
  if (
    value === "monday" ||
    value === "tuesday" ||
    value === "wednesday" ||
    value === "thursday" ||
    value === "friday" ||
    value === "saturday" ||
    value === "sunday"
  ) {
    return value;
  }
  return "monday";
}

function normalizeScheduleColorKey(value: unknown): ScheduleColorKey {
  if (value === "blue" || value === "emerald" || value === "amber" || value === "violet" || value === "rose") {
    return value;
  }
  return "blue";
}

function timeToMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
}

function normalizeScheduleTimeInput(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3] ?? "";

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    if (meridiem === "AM") {
      if (hours === 12) {
        hours = 0;
      }
    } else if (hours !== 12) {
      hours += 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function splitScheduleTimeForForm(value: string): { time: string; meridiem: "AM" | "PM" } | null {
  const normalized = normalizeScheduleTimeInput(value);
  if (!normalized) {
    return null;
  }
  const [hoursRaw, minutesRaw] = normalized.split(":");
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours)) {
    return null;
  }
  const period: "AM" | "PM" = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return {
    time: `${String(hours12).padStart(2, "0")}:${minutesRaw}`,
    meridiem: period,
  };
}

function normalizeScheduleTimeFromForm(value: string, meridiem: "AM" | "PM"): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withMeridiem = normalizeScheduleTimeInput(`${trimmed} ${meridiem}`);
  if (withMeridiem) {
    return withMeridiem;
  }
  return normalizeScheduleTimeInput(trimmed);
}

function formatScheduleTimeForDisplay(value: string): string {
  const split = splitScheduleTimeForForm(value);
  if (!split) {
    return value.trim();
  }
  const [hoursRaw, minutesRaw] = split.time.split(":");
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours)) {
    return value.trim();
  }
  return `${hours}:${minutesRaw} ${split.meridiem}`;
}

function formatScheduleTimeRangeForDisplay(startValue: string, endValue: string): string {
  return `${formatScheduleTimeForDisplay(startValue)} - ${formatScheduleTimeForDisplay(endValue)}`;
}

function buildScheduleSlots(startHour: number, totalSlots: number, slotMinutes: number) {
  return Array.from({ length: totalSlots }, (_, index) => {
    const start = startHour * 60 + index * slotMinutes;
    const end = start + slotMinutes;
    const startLabel = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
    const endLabel = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
    return {
      start,
      end,
      label: formatScheduleTimeRangeForDisplay(startLabel, endLabel),
    };
  });
}

function normalizeSalaCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_-]/g, "");
}

function buildUniqueSalaCode(existingRooms: SalaItem[]): string {
  const existing = new Set(existingRooms.map((room) => (room.code ?? "").toUpperCase()).filter((code) => !!code));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = `SALA-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `SALA-${Date.now().toString().slice(-8)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("No se pudo leer la imagen."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function clampProfileImageOffsetX(value: number, scale: number): number {
  const safeScale = Number.isFinite(scale) ? Math.max(1, scale) : 1;
  const limit = Math.max(0, (safeScale - 1) * 50);
  return Math.max(-limit, Math.min(limit, value));
}

function practiceDraftKey(userId: number, examId: number): string {
  return `smartlearn_practice_${userId}_${examId}`;
}

const adminMenu: MenuItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "users", label: "Usuarios" },
  { key: "profile", label: "Perfil" },
  { key: "support", label: "Soporte" },
];

const portalMenu: MenuItem[] = [
  { key: "inicio", label: "Inicio" },
  { key: "ia", label: "IA" },
  { key: "examenes", label: "Examenes" },
  { key: "cursos", label: "Cursos" },
  { key: "salas", label: "Salas" },
  { key: "horarios", label: "Horarios" },
  { key: "perfil", label: "Perfil" },
  { key: "ayuda", label: "Ayuda" },
];

type TutorialGuide = {
  sectionTitle: string;
  youtubeUrl: string | null;
  description: string;
  quickSteps: string[];
};

const defaultTutorialGuide: TutorialGuide = {
  sectionTitle: "SmartLearn",
  youtubeUrl: null,
  description: "Este tutorial te muestra el flujo general del modulo actual.",
  quickSteps: [
    "Revisa los botones principales del modulo.",
    "Crea o abre un recurso para practicar el flujo completo.",
    "Guarda cambios y valida resultados antes de salir.",
  ],
};

const tutorialGuideBySection: Record<string, TutorialGuide> = {
  dashboard: {
    sectionTitle: "Dashboard",
    youtubeUrl: null,
    description: "Resumen del panel principal y accesos rapidos.",
    quickSteps: [
      "Identifica los indicadores principales.",
      "Entra al modulo que necesitas desde el menu lateral.",
      "Usa el boton de tutorial del modulo cuando tengas dudas.",
    ],
  },
  inicio: {
    sectionTitle: "Inicio",
    youtubeUrl: null,
    description: "Guia general para navegar por SmartLearn.",
    quickSteps: [
      "Revisa los accesos principales del inicio.",
      "Selecciona el modulo de trabajo.",
      "Confirma que tu sesion y perfil esten correctos.",
    ],
  },
  ia: {
    sectionTitle: "IA",
    youtubeUrl: null,
    description: "Aprende a crear contenido y examenes asistidos por IA.",
    quickSteps: [
      "Selecciona o crea un chat.",
      "Escribe instrucciones claras para generar contenido.",
      "Valida y guarda el resultado generado.",
    ],
  },
  examenes: {
    sectionTitle: "Examenes",
    youtubeUrl: null,
    description: "Gestion de examenes, preguntas y repaso.",
    quickSteps: [
      "Crea o importa un examen.",
      "Configura preguntas, tiempos y opciones de repaso.",
      "Comparte permisos y valida el flujo grupal o individual.",
    ],
  },
  cursos: {
    sectionTitle: "Cursos",
    youtubeUrl: null,
    description: "Administracion de cursos, sesiones y contenidos.",
    quickSteps: [
      "Crea un curso o abre uno existente.",
      "Agrega sesiones y materiales.",
      "Asigna participantes y revisa progreso.",
    ],
  },
  salas: {
    sectionTitle: "Salas",
    youtubeUrl: null,
    description: "Uso de salas colaborativas y comparticion de pantalla.",
    quickSteps: [
      "Crea o ingresa a una sala.",
      "Gestiona participantes y chat.",
      "Comparte pantalla y controla permisos.",
    ],
  },
  horarios: {
    sectionTitle: "Horarios",
    youtubeUrl: null,
    description: "Configuracion de actividades y agenda semanal.",
    quickSteps: [
      "Crea actividades con dia y hora.",
      "Edita colores y ubicaciones.",
      "Valida la vista semanal o por imagen.",
    ],
  },
  perfil: {
    sectionTitle: "Perfil",
    youtubeUrl: null,
    description: "Actualizacion de datos personales y seguridad.",
    quickSteps: [
      "Edita tu informacion basica.",
      "Actualiza foto y contrasena.",
      "Guarda y verifica los cambios.",
    ],
  },
  profile: {
    sectionTitle: "Perfil",
    youtubeUrl: null,
    description: "Actualizacion de datos personales y seguridad.",
    quickSteps: [
      "Edita tu informacion basica.",
      "Actualiza foto y contrasena.",
      "Guarda y verifica los cambios.",
    ],
  },
  users: {
    sectionTitle: "Usuarios",
    youtubeUrl: null,
    description: "Gestion administrativa de usuarios y roles.",
    quickSteps: [
      "Filtra usuarios por estado y busqueda.",
      "Crea o edita perfiles.",
      "Asigna roles y permisos.",
    ],
  },
  support: {
    sectionTitle: "Soporte",
    youtubeUrl: null,
    description: "Administracion de solicitudes y conversaciones de soporte.",
    quickSteps: [
      "Revisa conversaciones activas.",
      "Responde y da seguimiento.",
      "Cierra tickets cuando el caso quede resuelto.",
    ],
  },
  ayuda: {
    sectionTitle: "Ayuda",
    youtubeUrl: null,
    description: "Centro de ayuda y preguntas frecuentes.",
    quickSteps: [
      "Busca el tema que necesitas.",
      "Abre el tutorial del modulo actual.",
      "Si persiste la duda, contacta soporte.",
    ],
  },
};

function resolveTutorialGuide(sectionKey: string): TutorialGuide {
  const normalized = sectionKey.trim().toLowerCase();
  return tutorialGuideBySection[normalized] ?? defaultTutorialGuide;
}

function extractYoutubeVideoId(urlValue: string | null): string | null {
  if (!urlValue) {
    return null;
  }
  try {
    const parsed = new URL(urlValue);
    const host = parsed.hostname.toLowerCase();
    let videoId: string | null = null;

    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? null;
    } else if (host.includes("youtube.com")) {
      if (parsed.pathname === "/watch") {
        videoId = parsed.searchParams.get("v");
      } else if (parsed.pathname.startsWith("/embed/")) {
        videoId = parsed.pathname.replace("/embed/", "").split("/")[0] ?? null;
      } else if (parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.replace("/shorts/", "").split("/")[0] ?? null;
      }
    }

    const normalizedId = (videoId ?? "").trim();
    return /^[A-Za-z0-9_-]{11}$/.test(normalizedId) ? normalizedId : null;
  } catch {
    return null;
  }
}

function MenuItemIcon({ itemKey }: { itemKey: string }) {
  const iconClass = "h-4 w-4 shrink-0";
  const baseProps = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    className: iconClass,
  } as const;

  switch (itemKey) {
    case "inicio":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m3 10 9-7 9 7" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10v10h14V10" />
        </svg>
      );
    case "ia":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />
        </svg>
      );
    case "examenes":
      return (
        <svg {...baseProps}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "cursos":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5 12 4l8 2.5v11L12 20l-8-2.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16" />
        </svg>
      );
    case "salas":
      return (
        <svg {...baseProps}>
          <circle cx="8" cy="9" r="3" />
          <circle cx="16" cy="9" r="3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 19a5 5 0 0 1 10 0M11 19a5 5 0 0 1 10 0" />
        </svg>
      );
    case "horarios":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
        </svg>
      );
    case "notificaciones":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17H9a4 4 0 0 1-4-4v-3a7 7 0 1 1 14 0v3a4 4 0 0 1-4 4Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case "estadisticas":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 20V11M10 20V7M16 20V13M22 20H2" />
        </svg>
      );
    case "perfil":
    case "profile":
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="8" r="4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "ayuda":
    case "support":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 1 1 16 0" />
          <rect x="3" y="12" width="4" height="6" rx="2" />
          <rect x="17" y="12" width="4" height="6" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h2" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...baseProps}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "users":
      return (
        <svg {...baseProps}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 7 0" />
        </svg>
      );
    case "projects":
      return (
        <svg {...baseProps}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...baseProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
    default:
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function dashboardSectionKey(userId: number): string {
  return `smartlearn_dashboard_section_${userId}`;
}

function dashboardIaChatKey(userId: number): string {
  return `smartlearn_dashboard_ia_chat_${userId}`;
}

function dashboardCourseViewKey(userId: number): string {
  return `smartlearn_dashboard_course_view_${userId}`;
}

function dashboardSalaViewKey(userId: number): string {
  return `smartlearn_dashboard_sala_view_${userId}`;
}

function dashboardGroupPracticeViewKey(userId: number): string {
  return `smartlearn_dashboard_group_practice_view_${userId}`;
}

function dashboardProfileImageKey(userId: number): string {
  return `smartlearn_dashboard_profile_image_${userId}`;
}

function dashboardSidebarOpenKey(userId: number): string {
  return `smartlearn_dashboard_sidebar_open_${userId}`;
}

function isIaChatSummaryPayload(value: unknown): value is ChatSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.name === "string" && "messagesCount" in record;
}

function isIaChatSummaryArrayPayload(value: unknown): value is ChatSummary[] {
  return Array.isArray(value) && value.every((item) => isIaChatSummaryPayload(item));
}

function isCourseExamItemPayload(value: unknown): value is CourseExamItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.name === "string";
}

function isCourseParticipantItemPayload(value: unknown): value is CourseParticipantItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "number" &&
    typeof record.name === "string" &&
    typeof record.username === "string" &&
    typeof record.email === "string" &&
    (!("role" in record) || record.role == null || typeof record.role === "string")
  );
}

function isCourseGradeItemPayload(value: unknown): value is CourseGradeItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "number" &&
    typeof record.name === "string" &&
    typeof record.username === "string" &&
    typeof record.email === "string"
  );
}

function isCourseCompetencyItemPayload(value: unknown): value is CourseCompetencyItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.name === "string";
}

function isCourseSessionItemPayload(value: unknown): value is CourseSessionItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.name === "string";
}

function isCoursePayload(value: unknown): value is CourseItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasValidSessions =
    !("sessions" in record) ||
    (Array.isArray(record.sessions) && record.sessions.every((session) => isCourseSessionItemPayload(session)));
  const hasValidParticipants =
    !("participants" in record) ||
    (Array.isArray(record.participants) &&
      record.participants.every((participant) => isCourseParticipantItemPayload(participant)));
  const hasValidGrades =
    !("grades" in record) || (Array.isArray(record.grades) && record.grades.every((grade) => isCourseGradeItemPayload(grade)));
  const hasValidCompetencies =
    !("competencies" in record) ||
    (Array.isArray(record.competencies) &&
      record.competencies.every((competency) => isCourseCompetencyItemPayload(competency)));
  return (
    typeof record.id === "number" &&
    typeof record.name === "string" &&
    (!("code" in record) || record.code == null || typeof record.code === "string") &&
    (!("visibility" in record) || record.visibility == null || record.visibility === "public" || record.visibility === "private") &&
    (!("priority" in record) ||
      record.priority == null ||
      record.priority === "very_important" ||
      record.priority === "important" ||
      record.priority === "low_important" ||
      record.priority === "optional") &&
    (!("sortOrder" in record) || record.sortOrder == null || typeof record.sortOrder === "number") &&
    Array.isArray(record.exams) &&
    record.exams.every((exam) => isCourseExamItemPayload(exam)) &&
    hasValidSessions &&
    hasValidParticipants &&
    hasValidGrades &&
    hasValidCompetencies
  );
}

function parseCourseModulePayload(value: unknown): CourseModulePayload {
  if (!value || typeof value !== "object") {
    return { courses: [], availableExams: [] };
  }
  const record = value as Record<string, unknown>;
  const courses = Array.isArray(record.courses) ? record.courses.filter((item) => isCoursePayload(item)) : [];
  const availableExams = Array.isArray(record.availableExams)
    ? record.availableExams.filter((item) => isCourseExamItemPayload(item))
    : [];
  return { courses, availableExams };
}

function isSalaParticipantPayload(value: unknown): value is SalaParticipant {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.name === "string" &&
    (!("micOn" in record) || typeof record.micOn === "boolean") &&
    (!("isScreenSharing" in record) || typeof record.isScreenSharing === "boolean")
  );
}

function isSalaMessagePayload(value: unknown): value is SalaMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.sender === "string" &&
    typeof record.content === "string" &&
    (!("isCurrentUser" in record) || typeof record.isCurrentUser === "boolean")
  );
}

function isSalaItemPayload(value: unknown): value is SalaItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.name === "string" &&
    typeof record.code === "string" &&
    typeof record.visibility === "string" &&
    Array.isArray(record.participants) &&
    record.participants.every((participant) => isSalaParticipantPayload(participant)) &&
    Array.isArray(record.messages) &&
    record.messages.every((message) => isSalaMessagePayload(message))
  );
}

function parseSalaModulePayload(value: unknown): SalaModulePayload {
  if (!value || typeof value !== "object") {
    return { salas: [], selectedSalaId: null };
  }
  const record = value as Record<string, unknown>;
  const salas = Array.isArray(record.salas) ? record.salas.filter((item) => isSalaItemPayload(item)) : [];
  return {
    salas: salas.map((sala) => ({
      ...sala,
      visibility: sala.visibility === "private" ? "private" : "public",
      description: sala.description?.trim() || "Sala sin descripcion.",
      imageData: sala.imageData?.trim() ? sala.imageData.trim() : null,
      ownerUserId: typeof sala.ownerUserId === "number" ? sala.ownerUserId : null,
      accessRole: typeof sala.accessRole === "string" ? sala.accessRole : "owner",
      canEdit: sala.canEdit !== false,
      canShare: sala.canShare === true,
      participants: sala.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        micOn: Boolean(participant.micOn),
        isScreenSharing: Boolean(participant.isScreenSharing),
      })),
      messages: sala.messages.map((message) => ({
        id: message.id,
        sender: message.sender,
        content: message.content,
        isCurrentUser: Boolean(message.isCurrentUser),
      })),
    })),
    selectedSalaId: typeof record.selectedSalaId === "number" ? record.selectedSalaId : null,
  };
}

function isScheduleActivityPayload(value: unknown): value is ScheduleActivity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.title === "string" &&
    typeof record.day === "string" &&
    typeof record.startTime === "string" &&
    typeof record.endTime === "string" &&
    typeof record.color === "string"
  );
}

function isScheduleProfileOptionPayload(value: unknown): value is ScheduleProfileOption {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.profileId === "number" && typeof record.profileName === "string";
}

function parseScheduleModulePayload(value: unknown): ScheduleModulePayload {
  if (!value || typeof value !== "object") {
    return {
      profileId: 0,
      profileName: "Mi horario",
      accessRole: "owner",
      canEdit: true,
      canShare: true,
      profiles: [],
      activities: [],
    };
  }
  const record = value as Record<string, unknown>;
  const activities = Array.isArray(record.activities)
    ? record.activities.filter((item) => isScheduleActivityPayload(item))
    : [];
  const parsedProfiles = Array.isArray(record.profiles)
    ? record.profiles.filter((item) => isScheduleProfileOptionPayload(item))
    : [];
  const fallbackProfileId = typeof record.profileId === "number" ? record.profileId : 0;
  const fallbackProfileName = typeof record.profileName === "string" ? record.profileName : "Mi horario";
  const fallbackProfile: ScheduleProfileOption = {
    profileId: fallbackProfileId,
    profileName: fallbackProfileName,
    ownerUserId: typeof record.ownerUserId === "number" ? record.ownerUserId : null,
    accessRole: typeof record.accessRole === "string" ? record.accessRole : "owner",
    canEdit: record.canEdit !== false,
    canShare: record.canShare === true,
    createdAt: record.createdAt,
  };
  const profilesById = new Map<number, ScheduleProfileOption>();
  parsedProfiles.forEach((profile) => {
    const normalizedId = Math.trunc(profile.profileId);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
      return;
    }
    profilesById.set(normalizedId, {
      profileId: normalizedId,
      profileName: typeof profile.profileName === "string" ? profile.profileName : "Horario",
      ownerUserId: typeof profile.ownerUserId === "number" ? profile.ownerUserId : null,
      ownerName: typeof profile.ownerName === "string" ? profile.ownerName : null,
      accessRole: typeof profile.accessRole === "string" ? profile.accessRole : "viewer",
      canEdit: profile.canEdit !== false,
      canShare: profile.canShare === true,
      createdAt: profile.createdAt,
    });
  });
  if (fallbackProfile.profileId > 0) {
    profilesById.set(fallbackProfile.profileId, fallbackProfile);
  }

  return {
    profileId: fallbackProfileId,
    profileName: fallbackProfileName,
    description: typeof record.description === "string" ? record.description : null,
    ownerUserId: typeof record.ownerUserId === "number" ? record.ownerUserId : null,
    accessRole: typeof record.accessRole === "string" ? record.accessRole : "owner",
    canEdit: record.canEdit !== false,
    canShare: record.canShare === true,
    profiles: Array.from(profilesById.values()),
    referenceImageData: typeof record.referenceImageData === "string" ? record.referenceImageData : null,
    referenceImageName: typeof record.referenceImageName === "string" ? record.referenceImageName : null,
    activities,
    createdAt: record.createdAt,
  };
}

function isShareRecipientPayload(value: unknown): value is ShareRecipient {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.name === "string" &&
    typeof record.username === "string" &&
    typeof record.email === "string"
  );
}

function isExamParticipantPayload(value: unknown): value is ExamParticipant {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "number" &&
    typeof record.name === "string" &&
    typeof record.username === "string" &&
    typeof record.email === "string" &&
    typeof record.role === "string"
  );
}

function isShareNotificationPayload(value: unknown): value is ShareNotificationItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.resourceType === "string" &&
    typeof record.resourceId === "number" &&
    (!("token" in record) || record.token == null || typeof record.token === "string") &&
    (!("invitationStatus" in record) || record.invitationStatus == null || typeof record.invitationStatus === "string")
  );
}

function normalizeInvitationStatus(value: unknown): "pending" | "accepted" | "rejected" {
  if (typeof value !== "string") {
    return "accepted";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "pending" || normalized === "accepted" || normalized === "rejected") {
    return normalized;
  }
  return "accepted";
}

function notificationRequiresInvitationResponse(resourceType: unknown): boolean {
  if (typeof resourceType !== "string") {
    return false;
  }
  const normalized = resourceType.trim().toLowerCase();
  return normalized === "exam" || normalized === "schedule";
}

function isSupportConversationPayload(value: unknown): value is SupportConversationItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.subject === "string" &&
    typeof record.status === "string" &&
    typeof record.priority === "string" &&
    typeof record.channelPreference === "string"
  );
}

function isSupportMessagePayload(value: unknown): value is SupportMessageItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.conversationId === "number" && typeof record.content === "string";
}

function isSupportCallRequestPayload(value: unknown): value is SupportCallRequestItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.phoneNumber === "string" && typeof record.reason === "string";
}

function parseSupportModulePayload(value: unknown): SupportModulePayload {
  if (!value || typeof value !== "object") {
    return { conversations: [], adminQueue: [], callRequests: [], adminView: false };
  }
  const record = value as Record<string, unknown>;
  const conversations = Array.isArray(record.conversations)
    ? record.conversations.filter((item) => isSupportConversationPayload(item))
    : [];
  const adminQueue = Array.isArray(record.adminQueue)
    ? record.adminQueue.filter((item) => isSupportConversationPayload(item))
    : [];
  const callRequests = Array.isArray(record.callRequests)
    ? record.callRequests.filter((item) => isSupportCallRequestPayload(item))
    : [];
  const adminView = record.adminView === true;
  return { conversations, adminQueue, callRequests, adminView };
}

function parseSessionOrderFromName(name: string): number | null {
  const normalized = name.trim();
  const match = normalized.match(/^sesion\s+(\d+)\s*:/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

function getNextSessionOrder(sessions: CourseSessionItem[]): number {
  let maxOrder = 0;
  sessions.forEach((session) => {
    const parsed = parseSessionOrderFromName(session.name);
    if (parsed != null && parsed > maxOrder) {
      maxOrder = parsed;
    }
  });
  if (maxOrder > 0) {
    return maxOrder + 1;
  }
  return sessions.length + 1;
}

function formatSessionName(name: string): string {
  const normalized = name.trim();
  const match = normalized.match(/^sesion\s+(\d+)\s*:\s*(.*)$/i);
  if (!match) {
    return normalized;
  }
  const order = Number(match[1]);
  const title = (match[2] ?? "").trim();
  if (!Number.isFinite(order) || order <= 0) {
    return normalized;
  }
  return `SESION ${Math.trunc(order)}: ${title || "Sin titulo"}`;
}

function isAdminSessionUser(user: Pick<SessionUser, "roles" | "username" | "email">): boolean {
  const hasAdminRole = user.roles.some((role) => role.toLowerCase() === "admin");
  const isAdminByIdentity =
    user.username.toLowerCase() === "admin" || user.email.toLowerCase() === "admin@a21k.com";
  return hasAdminRole || isAdminByIdentity;
}

export default function DashboardPage() {
  const router = useRouter();
  const [shareTokenFromUrl, setShareTokenFromUrl] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [active, setActive] = useState("");
  const [sessionExpiredModalOpen, setSessionExpiredModalOpen] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState("");
  const inactivityTimerRef = useRef<number | null>(null);
  const inactivityIntervalRef = useRef<number | null>(null);
  const lastActivityAtRef = useRef<number>(Date.now());
  const sessionExpiredHandledRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncShareTokenFromUrl = () => {
      const token = new URL(window.location.href).searchParams.get("share");
      setShareTokenFromUrl((token ?? "").trim());
    };
    syncShareTokenFromUrl();
    window.addEventListener("popstate", syncShareTokenFromUrl);
    return () => window.removeEventListener("popstate", syncShareTokenFromUrl);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<unknown>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userPerPage, setUserPerPage] = useState("10");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [userPage, setUserPage] = useState(1);
  const [userMessage, setUserMessage] = useState("");
  const [userMessageType, setUserMessageType] = useState<"info" | "success" | "error">("info");
  const [showCreateUserPanel, setShowCreateUserPanel] = useState(false);
  const [showManageRolesPanel, setShowManageRolesPanel] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [rolesData, setRolesData] = useState<AdminRoleRow[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selectedRolePermissions, setSelectedRolePermissions] = useState<string[]>([]);
  const [creatingUser, setCreatingUser] = useState(false);
  const [showEditUserPanel, setShowEditUserPanel] = useState(false);
  const [updatingUser, setUpdatingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [newUserFirstName, setNewUserFirstName] = useState("");
  const [newUserLastName, setNewUserLastName] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");
  const [editUserFirstName, setEditUserFirstName] = useState("");
  const [editUserLastName, setEditUserLastName] = useState("");
  const [editUserUsername, setEditUserUsername] = useState("");
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserPassword, setEditUserPassword] = useState("");
  const [editUserRole, setEditUserRole] = useState<"user" | "admin">("user");
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileImageData, setProfileImageData] = useState<string | null>(null);
  const [profileImageScale, setProfileImageScale] = useState(1);
  const [profileImageOffsetX, setProfileImageOffsetX] = useState(0);
  const [profileImageOffsetY, setProfileImageOffsetY] = useState(0);
  const [showEditProfileImageModal, setShowEditProfileImageModal] = useState(false);
  const [profileImageDraftData, setProfileImageDraftData] = useState<string | null>(null);
  const [profileImageDraftScale, setProfileImageDraftScale] = useState(1);
  const [profileImageDraftOffsetX, setProfileImageDraftOffsetX] = useState(0);
  const [profileImageDraftOffsetY, setProfileImageDraftOffsetY] = useState(0);
  const [profileImageDragging, setProfileImageDragging] = useState(false);
  const profileImageEditorViewportRef = useRef<HTMLDivElement | null>(null);
  const [profileInfoSaving, setProfileInfoSaving] = useState(false);
  const [profileImageSaving, setProfileImageSaving] = useState(false);
  const [profileInfoMessage, setProfileInfoMessage] = useState("");
  const [profileInfoMessageType, setProfileInfoMessageType] = useState<"success" | "error">("success");
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [profileNewPassword, setProfileNewPassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [profilePasswordSaving, setProfilePasswordSaving] = useState(false);
  const [profilePasswordMessage, setProfilePasswordMessage] = useState("");
  const [profilePasswordMessageType, setProfilePasswordMessageType] = useState<"success" | "error">("success");
  const [showDeleteAccountPanel, setShowDeleteAccountPanel] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [deleteAccountSaving, setDeleteAccountSaving] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");
  const [deleteAccountMessageType, setDeleteAccountMessageType] = useState<"success" | "error">("error");
  const [iaSelectedChatId, setIaSelectedChatId] = useState<number | null>(null);
  const [iaSelectedChat, setIaSelectedChat] = useState<ChatDetail | null>(null);
  const [iaIsNewChatMode, setIaIsNewChatMode] = useState(false);
  const [iaChatMenuOpenId, setIaChatMenuOpenId] = useState<number | null>(null);
  const [iaDraftMessage, setIaDraftMessage] = useState("");
  const [iaChatAttachments, setIaChatAttachments] = useState<File[]>([]);
  const [iaAttachmentInputKey, setIaAttachmentInputKey] = useState(0);
  const [iaExamName, setIaExamName] = useState("");
  const [iaExamInstructions, setIaExamInstructions] = useState("");
  const [iaExamQuestionsCount, setIaExamQuestionsCount] = useState("20");
  const [iaExamFiles, setIaExamFiles] = useState<File[]>([]);
  const [iaLoadingChat, setIaLoadingChat] = useState(false);
  const [iaSendingMessage, setIaSendingMessage] = useState(false);
  const [iaGeneratingExam, setIaGeneratingExam] = useState(false);
  const [iaStatus, setIaStatus] = useState("");
  const [iaStatusType, setIaStatusType] = useState<"info" | "success" | "error">("info");
  const [iaModels, setIaModels] = useState<string[]>([]);
  const [iaSelectedModel, setIaSelectedModel] = useState("");
  const [iaLoadingModels, setIaLoadingModels] = useState(false);
  const [manualExamName, setManualExamName] = useState("");
  const [examSearch, setExamSearch] = useState("");
  const [examPerPage, setExamPerPage] = useState("20");
  const [examPage, setExamPage] = useState(1);
  const [showExamFilters, setShowExamFilters] = useState(false);
  const [examAttemptsFilter, setExamAttemptsFilter] = useState<"all" | "with_attempts" | "without_attempts">("all");
  const [examQuestionsFilter, setExamQuestionsFilter] = useState<"all" | "with_questions" | "without_questions">("all");
  const [examMessage, setExamMessage] = useState("");
  const [examMessageType, setExamMessageType] = useState<"info" | "success" | "error">("info");
  const [courseName, setCourseName] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseVisibility, setCourseVisibility] = useState<"public" | "private">("public");
  const [courseCoverImageData, setCourseCoverImageData] = useState<string | null>(null);
  const [courseCoverImageName, setCourseCoverImageName] = useState("");
  const [courseSessionName, setCourseSessionName] = useState("");
  const [courseSessionWeeklyContent, setCourseSessionWeeklyContent] = useState("");
  const [showCreateCourseSessionModal, setShowCreateCourseSessionModal] = useState(false);
  const [showEditCourseSessionModal, setShowEditCourseSessionModal] = useState(false);
  const [editingCourseSessionId, setEditingCourseSessionId] = useState<number | null>(null);
  const [editingCourseSessionName, setEditingCourseSessionName] = useState("");
  const [editingCourseSessionWeeklyContent, setEditingCourseSessionWeeklyContent] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [showAddSessionContentModal, setShowAddSessionContentModal] = useState(false);
  const [addingContentSessionId, setAddingContentSessionId] = useState<number | null>(null);
  const [addingContentSessionName, setAddingContentSessionName] = useState("");
  const [editingSessionContentId, setEditingSessionContentId] = useState<number | null>(null);
  const [sessionContentType, setSessionContentType] = useState<"video" | "pdf" | "word" | "portada" | "examen">(
    "video",
  );
  const [sessionContentName, setSessionContentName] = useState("");
  const [sessionVideoLink, setSessionVideoLink] = useState("");
  const [sessionCoverImageData, setSessionCoverImageData] = useState<string | null>(null);
  const [sessionPdfFileName, setSessionPdfFileName] = useState("");
  const [sessionPdfFileData, setSessionPdfFileData] = useState<string | null>(null);
  const [sessionWordFileName, setSessionWordFileName] = useState("");
  const [sessionWordFileData, setSessionWordFileData] = useState<string | null>(null);
  const [sessionExamSourceId, setSessionExamSourceId] = useState("");
  const [creatingCourseSession, setCreatingCourseSession] = useState(false);
  const [updatingCourseSession, setUpdatingCourseSession] = useState(false);
  const [savingSessionContent, setSavingSessionContent] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [showEditCourseModal, setShowEditCourseModal] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<number | null>(null);
  const [editingCourseName, setEditingCourseName] = useState("");
  const [editingCourseDescription, setEditingCourseDescription] = useState("");
  const [editingCourseCode, setEditingCourseCode] = useState("");
  const [editingCourseVisibility, setEditingCourseVisibility] = useState<"public" | "private">("public");
  const [showManageCourseModal, setShowManageCourseModal] = useState(false);
  const [managingCourseId, setManagingCourseId] = useState<number | null>(null);
  const [managingCoursePriority, setManagingCoursePriority] = useState<
    "very_important" | "important" | "low_important" | "optional"
  >("important");
  const [managingCourseSortOrder, setManagingCourseSortOrder] = useState("0");
  const [showDeleteCourseModal, setShowDeleteCourseModal] = useState(false);
  const [deleteCourseTarget, setDeleteCourseTarget] = useState<CourseItem | null>(null);
  const [courseActionMenuId, setCourseActionMenuId] = useState<number | null>(null);
  const [openedCourseId, setOpenedCourseId] = useState<number | null>(null);
  const [openedCourseTab, setOpenedCourseTab] = useState<"curso" | "participantes" | "calificaciones" | "competencias">(
    "curso",
  );
  const [courseYearFilter, setCourseYearFilter] = useState("all");
  const [courseProgressFilter, setCourseProgressFilter] = useState("all");
  const [courseScopeFilter, setCourseScopeFilter] = useState<"all" | "mine" | "shared" | "public" | "private">("all");
  const [courseSearchQuery, setCourseSearchQuery] = useState("");
  const [courseSortMode, setCourseSortMode] = useState<"name_asc" | "name_desc" | "newest" | "oldest">("name_asc");
  const [savingCourseId, setSavingCourseId] = useState<number | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<number | null>(null);
  const [courseMessage, setCourseMessage] = useState("");
  const [courseMessageType, setCourseMessageType] = useState<"info" | "success" | "error">("info");
  const [courseParticipantIdentifier, setCourseParticipantIdentifier] = useState("");
  const [courseParticipantRole, setCourseParticipantRole] = useState<"viewer" | "editor" | "assistant">("viewer");
  const [addingCourseParticipant, setAddingCourseParticipant] = useState(false);
  const [savingCourseParticipantUserId, setSavingCourseParticipantUserId] = useState<number | null>(null);
  const [courseCompetencyName, setCourseCompetencyName] = useState("");
  const [courseCompetencyDescription, setCourseCompetencyDescription] = useState("");
  const [courseCompetencyLevel, setCourseCompetencyLevel] = useState<"basico" | "intermedio" | "avanzado">("basico");
  const [courseCompetencySortOrder, setCourseCompetencySortOrder] = useState("0");
  const [editingCourseCompetencyId, setEditingCourseCompetencyId] = useState<number | null>(null);
  const [savingCourseCompetency, setSavingCourseCompetency] = useState(false);
  const [deletingCourseCompetencyId, setDeletingCourseCompetencyId] = useState<number | null>(null);
  const [courseContentPreviewOpen, setCourseContentPreviewOpen] = useState(false);
  const [courseContentPreviewTitle, setCourseContentPreviewTitle] = useState("");
  const [courseContentPreviewUrl, setCourseContentPreviewUrl] = useState("");
  const [courseContentPreviewType, setCourseContentPreviewType] = useState<"pdf" | "video" | "file">("pdf");
  const [courseContentPreviewObjectUrl, setCourseContentPreviewObjectUrl] = useState<string | null>(null);
  const [creatingManualExam, setCreatingManualExam] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showGroupSettingsModal, setShowGroupSettingsModal] = useState(false);
  const [showIndividualSettingsModal, setShowIndividualSettingsModal] = useState(false);
  const [showPracticeModal, setShowPracticeModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [uploadExamName, setUploadExamName] = useState("");
  const [uploadExamFile, setUploadExamFile] = useState<File | null>(null);
  const [uploadingExam, setUploadingExam] = useState(false);
  const [selectedExam, setSelectedExam] = useState<ExamSummary | null>(null);
  const [managedExamQuestions, setManagedExamQuestions] = useState<ExamQuestion[]>([]);
  const [manualQuestionForm, setManualQuestionForm] =
    useState<ManualQuestionFormState>(createEmptyManualQuestionForm());
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [savingManualQuestion, setSavingManualQuestion] = useState(false);
  const [manualQuestionOrder, setManualQuestionOrder] = useState<"newest" | "oldest">("newest");
  const [practiceFeedbackMode, setPracticeFeedbackMode] = useState<PracticeFeedbackMode>("with_feedback");
  const [practiceOrderMode, setPracticeOrderMode] = useState<PracticeOrderMode>("ordered");
  const [practiceProgressMode, setPracticeProgressMode] = useState<PracticeProgressMode>("repeat_until_correct");
  const [individualPracticeSettingsByExamId, setIndividualPracticeSettingsByExamId] =
    useState<Record<number, PracticeSettingsPayload>>({});
  const [practiceExamVisibility, setPracticeExamVisibility] = useState<"public" | "private">("private");
  const [savingPracticeSettings, setSavingPracticeSettings] = useState(false);
  const [startingPractice, setStartingPractice] = useState(false);
  const [practiceIntent, setPracticeIntent] = useState<"start" | "restart">("start");
  const [practiceStartMode, setPracticeStartMode] = useState<"personal" | "group">("personal");
  const [showPracticeRunnerModal, setShowPracticeRunnerModal] = useState(false);
  const [showGroupPracticeRunnerModal, setShowGroupPracticeRunnerModal] = useState(false);
  const [groupPracticeState, setGroupPracticeState] = useState<ExamGroupState | null>(null);
  const [groupPracticeLoading, setGroupPracticeLoading] = useState(false);
  const [groupPracticeLoadingExamId, setGroupPracticeLoadingExamId] = useState<number | null>(null);
  const [closingGroupWaitingRoom, setClosingGroupWaitingRoom] = useState(false);
  const [showGroupRoomClosedModal, setShowGroupRoomClosedModal] = useState(false);
  const [groupRoomClosedMessage, setGroupRoomClosedMessage] = useState("La sala grupal fue cerrada por el anfitrion.");
  const [groupRoomClosedKeepViewing, setGroupRoomClosedKeepViewing] = useState(false);
  const [groupRoomClosedAllowKeepViewing, setGroupRoomClosedAllowKeepViewing] = useState(true);
  const [submittingGroupAnswer, setSubmittingGroupAnswer] = useState(false);
  const [advancingGroupQuestion, setAdvancingGroupQuestion] = useState(false);
  const [closingAndRestartingGroupPractice, setClosingAndRestartingGroupPractice] = useState(false);
  const [groupQuestionElapsedSeconds, setGroupQuestionElapsedSeconds] = useState(0);
  const [groupQuestionRemainingSeconds, setGroupQuestionRemainingSeconds] = useState<number | null>(null);
  const [groupAutoSubmitKey, setGroupAutoSubmitKey] = useState<string | null>(null);
  const [groupTimerExpired, setGroupTimerExpired] = useState(false);
  const [groupTimerExpiredQuestionKey, setGroupTimerExpiredQuestionKey] = useState<string | null>(null);
  const groupQuestionRuntimeKeyRef = useRef<string | null>(null);
  const groupReviewQuestionKeyRef = useRef<string | null>(null);
  const groupReviewStartedAtMsRef = useRef<number | null>(null);
  const groupStatePollInFlightRef = useRef(false);
  const suppressGroupRoomClosedModalRef = useRef(false);
  const groupReviewRefreshInFlightRef = useRef(false);
  const groupInputQuestionKeyRef = useRef<string | null>(null);
  const [groupAnswersByQuestionKey, setGroupAnswersByQuestionKey] = useState<Record<string, ExamGroupCurrentAnswer[]>>({});
  const groupQuestionStartedAt = groupPracticeState?.questionStartedAt ?? null;
  const groupQuestionStartedAtEpochMs = groupPracticeState?.questionStartedAtEpochMs ?? null;
  const groupFirstResponderName = groupPracticeState?.firstResponderName ?? null;
  const groupFirstAnswerElapsedSeconds = groupPracticeState?.firstAnswerElapsedSeconds ?? null;
  const groupCanStartGroup = Boolean(groupPracticeState?.canStartGroup);
  const [groupAutoAdvanceSecondsLeft, setGroupAutoAdvanceSecondsLeft] = useState<number | null>(null);
  const [groupSubmittedQuestionKey, setGroupSubmittedQuestionKey] = useState<string | null>(null);
  const [groupDraftQuestionKey, setGroupDraftQuestionKey] = useState<string | null>(null);
  const [practiceQuestions, setPracticeQuestions] = useState<ExamQuestion[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceSelectedOption, setPracticeSelectedOption] = useState<"a" | "b" | "c" | "d" | null>(null);
  const [practiceWrittenAnswer, setPracticeWrittenAnswer] = useState("");
  const [practiceFeedbackStatus, setPracticeFeedbackStatus] = useState<PracticeStatus | null>(null);
  const [practiceResults, setPracticeResults] = useState<Record<number, PracticeStatus>>({});
  const [practiceStartedAt, setPracticeStartedAt] = useState(0);
  const [practiceFinished, setPracticeFinished] = useState(false);
  const [practiceChronoSeconds, setPracticeChronoSeconds] = useState(0);
  const [practiceRemainingSeconds, setPracticeRemainingSeconds] = useState<number | null>(null);
  const [practiceOriginSection, setPracticeOriginSection] = useState<"ia" | "examenes" | "cursos">("examenes");
  const [salasData, setSalasData] = useState<SalaItem[]>([]);
  const [selectedSalaId, setSelectedSalaId] = useState<number | null>(null);
  const [salasParticipantsOpen, setSalasParticipantsOpen] = useState(false);
  const [salasChatOpen, setSalasChatOpen] = useState(true);
  const [salasSharedScreensOpen, setSalasSharedScreensOpen] = useState(true);
  const [salaDraftMessage, setSalaDraftMessage] = useState("");
  const [salaPinnedScreenParticipantId, setSalaPinnedScreenParticipantId] = useState<number | null>(null);
  const [salaMaximizedScreenParticipantId, setSalaMaximizedScreenParticipantId] = useState<number | null>(null);
  const [salaPinnedZoom, setSalaPinnedZoom] = useState(1);
  const [salaPinnedPanX, setSalaPinnedPanX] = useState(0);
  const [salaPinnedPanY, setSalaPinnedPanY] = useState(0);
  const [salaMaxZoom, setSalaMaxZoom] = useState(1);
  const [salaMaxPanX, setSalaMaxPanX] = useState(0);
  const [salaMaxPanY, setSalaMaxPanY] = useState(0);
  const [salaControlRequestPending, setSalaControlRequestPending] = useState(false);
  const [salaControlRequestTargetId, setSalaControlRequestTargetId] = useState<number | null>(null);
  const [salaControlGrantedParticipantId, setSalaControlGrantedParticipantId] = useState<number | null>(null);
  const [salaRemotePointerX, setSalaRemotePointerX] = useState(50);
  const [salaRemotePointerY, setSalaRemotePointerY] = useState(50);
  const [salaRemoteInputDraft, setSalaRemoteInputDraft] = useState("");
  const [salaRemoteLastCommand, setSalaRemoteLastCommand] = useState("");
  const salaPinnedViewportRef = useRef<HTMLDivElement | null>(null);
  const salaMaxViewportRef = useRef<HTMLDivElement | null>(null);
  const [showCreateSalaModal, setShowCreateSalaModal] = useState(false);
  const [newSalaName, setNewSalaName] = useState("");
  const [newSalaCode, setNewSalaCode] = useState("");
  const [newSalaVisibility, setNewSalaVisibility] = useState<"public" | "private">("public");
  const [newSalaDescription, setNewSalaDescription] = useState("");
  const [newSalaImageData, setNewSalaImageData] = useState<string | null>(null);
  const [newSalaImageName, setNewSalaImageName] = useState("");
  const [showEditSalaModal, setShowEditSalaModal] = useState(false);
  const [editingSalaId, setEditingSalaId] = useState<number | null>(null);
  const [editSalaName, setEditSalaName] = useState("");
  const [editSalaCode, setEditSalaCode] = useState("");
  const [editSalaVisibility, setEditSalaVisibility] = useState<"public" | "private">("public");
  const [editSalaDescription, setEditSalaDescription] = useState("");
  const [editSalaImageData, setEditSalaImageData] = useState<string | null>(null);
  const [editSalaImageName, setEditSalaImageName] = useState("");
  const [salaVisibilityFilter, setSalaVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [deleteSalaTarget, setDeleteSalaTarget] = useState<SalaItem | null>(null);
  const [salaActionMenuId, setSalaActionMenuId] = useState<number | null>(null);
  const [salaMessage, setSalaMessage] = useState("");
  const [salaMessageType, setSalaMessageType] = useState<"info" | "success" | "error">("info");
  const [scheduleViewMode, setScheduleViewMode] = useState<"weekly" | "image">("weekly");
  const [scheduleReferenceImageData, setScheduleReferenceImageData] = useState<string | null>(null);
  const [scheduleReferenceImageName, setScheduleReferenceImageName] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleMessageType, setScheduleMessageType] = useState<"info" | "success" | "error">("info");
  const [scheduleActionMenuId, setScheduleActionMenuId] = useState<number | null>(null);
  const [scheduleProfileId, setScheduleProfileId] = useState<number | null>(null);
  const [scheduleProfileName, setScheduleProfileName] = useState("Mi horario");
  const [scheduleAccessRole, setScheduleAccessRole] = useState("owner");
  const [scheduleOwnerUserId, setScheduleOwnerUserId] = useState<number | null>(null);
  const [scheduleCanEdit, setScheduleCanEdit] = useState(true);
  const [scheduleCanShare, setScheduleCanShare] = useState(true);
  const [schedulePreferredProfileId, setSchedulePreferredProfileId] = useState<number | null>(null);
  const [scheduleProfiles, setScheduleProfiles] = useState<ScheduleProfileOption[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [savingScheduleActivity, setSavingScheduleActivity] = useState(false);
  const [deletingScheduleActivityId, setDeletingScheduleActivityId] = useState<number | null>(null);
  const [scheduleActivities, setScheduleActivities] = useState<ScheduleActivity[]>([]);
  const [scheduleFormTitle, setScheduleFormTitle] = useState("");
  const [scheduleFormDescription, setScheduleFormDescription] = useState("");
  const [scheduleFormDay, setScheduleFormDay] = useState<ScheduleDayKey>("monday");
  const [scheduleFormStartTime, setScheduleFormStartTime] = useState("08:00");
  const [scheduleFormStartMeridiem, setScheduleFormStartMeridiem] = useState<"AM" | "PM">("AM");
  const [scheduleFormEndTime, setScheduleFormEndTime] = useState("09:30");
  const [scheduleFormEndMeridiem, setScheduleFormEndMeridiem] = useState<"AM" | "PM">("AM");
  const [scheduleFormLocation, setScheduleFormLocation] = useState("");
  const [scheduleFormColor, setScheduleFormColor] = useState<ScheduleColorKey>("blue");
  const [showCreateScheduleModal, setShowCreateScheduleModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<{
    resourceType: ShareResourceType;
    resourceId: number;
    resourceName: string;
  } | null>(null);
  const [creatingShareLink, setCreatingShareLink] = useState(false);
  const [publicShareLink, setPublicShareLink] = useState("");
  const [publicShareLinksByResource, setPublicShareLinksByResource] = useState<Record<string, string>>({});
  const [creatingPublicShareLink, setCreatingPublicShareLink] = useState(false);
  const [shareRecipients, setShareRecipients] = useState<ShareRecipient[]>([]);
  const [shareRecipientsLoading, setShareRecipientsLoading] = useState(false);
  const [shareRecipientSearch, setShareRecipientSearch] = useState("");
  const [shareSelectedRecipientIds, setShareSelectedRecipientIds] = useState<number[]>([]);
  const [shareExamRole, setShareExamRole] = useState<"viewer" | "editor">("viewer");
  const [shareExamCanShare, setShareExamCanShare] = useState(false);
  const [showExamParticipantsModal, setShowExamParticipantsModal] = useState(false);
  const [examParticipantsTarget, setExamParticipantsTarget] = useState<ExamSummary | null>(null);
  const [homeShareNotifications, setHomeShareNotifications] = useState<ShareNotificationItem[]>([]);
  const [homeShareNotificationsLoading, setHomeShareNotificationsLoading] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false);
  const [claimedExamInvitePrompt, setClaimedExamInvitePrompt] = useState<{
    examId: number;
    examName: string;
    message: string;
    cachedExams: ExamSummary[];
  } | null>(null);
  const [showRenameExamModal, setShowRenameExamModal] = useState(false);
  const [renameExamTarget, setRenameExamTarget] = useState<ExamSummary | null>(null);
  const [renameExamNameDraft, setRenameExamNameDraft] = useState("");
  const [renamingExam, setRenamingExam] = useState(false);
  const [examParticipantsLoading, setExamParticipantsLoading] = useState(false);
  const [examParticipants, setExamParticipants] = useState<ExamParticipant[]>([]);
  const [updatingExamParticipantUserId, setUpdatingExamParticipantUserId] = useState<number | null>(null);
  const [removeExamParticipantPrompt, setRemoveExamParticipantPrompt] = useState<{
    examId: number;
    examName: string;
    participant: ExamParticipant;
  } | null>(null);
  const [notificationActionLoadingId, setNotificationActionLoadingId] = useState<number | null>(null);
  const [supportSelectedConversationId, setSupportSelectedConversationId] = useState<number | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessageItem[]>([]);
  const [supportLoadingMessages, setSupportLoadingMessages] = useState(false);
  const [supportCreatingConversation, setSupportCreatingConversation] = useState(false);
  const [supportSendingMessage, setSupportSendingMessage] = useState(false);
  const [supportCreatingCallRequest, setSupportCreatingCallRequest] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportInitialMessage, setSupportInitialMessage] = useState("");
  const [supportPriority, setSupportPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [supportChannel, setSupportChannel] = useState<"chat" | "whatsapp" | "call">("chat");
  const [supportWhatsappNumber, setSupportWhatsappNumber] = useState("");
  const [supportCallNumber, setSupportCallNumber] = useState("");
  const [supportDraftMessage, setSupportDraftMessage] = useState("");
  const [supportCallPhone, setSupportCallPhone] = useState("");
  const [supportCallSchedule, setSupportCallSchedule] = useState("");
  const [supportCallReason, setSupportCallReason] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportMessageType, setSupportMessageType] = useState<"info" | "success" | "error">("info");
  const claimedShareTokenRef = useRef("");
  const courseViewHydratedRef = useRef(false);
  const salaViewHydratedRef = useRef(false);
  const dashboardHistoryHydratedRef = useRef(false);
  const skipNextHistoryPushRef = useRef(false);
  const syncingHistoryPopRef = useRef(false);
  const courseHistoryHydratedRef = useRef(false);
  const skipNextCourseHistoryPushRef = useRef(false);
  const syncingCourseHistoryPopRef = useRef(false);
  const groupPracticeRestoreTriedRef = useRef(false);
  const shareRecipientsRequestVersionRef = useRef(0);

  useEffect(() => {
    const token = localStorage.getItem("smartlearn_token");
    const userRaw = localStorage.getItem("smartlearn_user");

    if (!token || !userRaw) {
      router.replace("/");
      return;
    }

    try {
      const parsed = JSON.parse(userRaw) as SessionUser;
      const fullUser: SessionUser = {
        ...parsed,
        token,
      };
      const savedSidebarOpen = localStorage.getItem(dashboardSidebarOpenKey(parsed.id));
      if (savedSidebarOpen === "0") {
        setSidebarOpen(false);
      } else if (savedSidebarOpen === "1") {
        setSidebarOpen(true);
      }
      setUser(fullUser);
      const admin = isAdminSessionUser(fullUser);
      const allowedSections = (admin ? adminMenu : portalMenu).map((item) => item.key);
      const savedSection = localStorage.getItem(dashboardSectionKey(parsed.id));
      const sectionFromUrl =
        typeof window !== "undefined" ? (new URL(window.location.href).searchParams.get("section") ?? "").trim().toLowerCase() : "";
      const nextSection =
        sectionFromUrl && allowedSections.includes(sectionFromUrl)
          ? sectionFromUrl
          : savedSection && allowedSections.includes(savedSection)
            ? savedSection
            : admin
              ? "dashboard"
              : "inicio";

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (url.pathname === "/dashboard") {
          url.searchParams.set("section", nextSection);
          const historyState =
            typeof window.history.state === "object" && window.history.state != null
              ? (window.history.state as Record<string, unknown>)
              : {};
          window.history.replaceState(
            { ...historyState, smartlearnSection: nextSection },
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        }
      }

      skipNextHistoryPushRef.current = true;
      dashboardHistoryHydratedRef.current = true;
      setActive(nextSection);

      let nextOpenedCourseId: number | null = null;
      let nextOpenedCourseTab: "curso" | "participantes" | "calificaciones" | "competencias" = "curso";
      let nextExpandedSessionId: number | null = null;

      const rawCourseView = localStorage.getItem(dashboardCourseViewKey(parsed.id));
      if (rawCourseView) {
        try {
          const parsedCourseView = JSON.parse(rawCourseView) as {
            openedCourseId?: unknown;
            openedCourseTab?: unknown;
            expandedSessionId?: unknown;
          };
          nextOpenedCourseId =
            typeof parsedCourseView.openedCourseId === "number" && Number.isFinite(parsedCourseView.openedCourseId)
              ? parsedCourseView.openedCourseId
              : null;
          nextOpenedCourseTab =
            parsedCourseView.openedCourseTab === "participantes" ||
            parsedCourseView.openedCourseTab === "calificaciones" ||
            parsedCourseView.openedCourseTab === "competencias"
              ? parsedCourseView.openedCourseTab
              : "curso";
          nextExpandedSessionId =
            typeof parsedCourseView.expandedSessionId === "number" && Number.isFinite(parsedCourseView.expandedSessionId)
              ? parsedCourseView.expandedSessionId
              : null;
        } catch {
          localStorage.removeItem(dashboardCourseViewKey(parsed.id));
        }
      }

      if (typeof window !== "undefined") {
        const courseUrl = new URL(window.location.href);
        const rawCourseId = (courseUrl.searchParams.get("courseId") ?? "").trim();
        const parsedCourseId = Number(rawCourseId);
        const courseIdFromUrl =
          Number.isFinite(parsedCourseId) && parsedCourseId > 0 ? Math.trunc(parsedCourseId) : null;
        if (courseIdFromUrl != null) {
          const rawCourseTab = (courseUrl.searchParams.get("courseTab") ?? "").trim().toLowerCase();
          const courseTabFromUrl =
            rawCourseTab === "participantes" || rawCourseTab === "calificaciones" || rawCourseTab === "competencias"
              ? rawCourseTab
              : "curso";
          nextOpenedCourseId = courseIdFromUrl;
          nextOpenedCourseTab = courseTabFromUrl;
        }
      }

      setOpenedCourseId(nextOpenedCourseId);
      setOpenedCourseTab(nextOpenedCourseTab);
      setExpandedSessionId(nextExpandedSessionId);
      courseViewHydratedRef.current = true;
      courseHistoryHydratedRef.current = true;
      skipNextCourseHistoryPushRef.current = true;

      const rawSalaView = localStorage.getItem(dashboardSalaViewKey(parsed.id));
      if (rawSalaView) {
        try {
          const parsedSalaView = JSON.parse(rawSalaView) as {
            selectedSalaId?: unknown;
            salasParticipantsOpen?: unknown;
            salasChatOpen?: unknown;
            salasSharedScreensOpen?: unknown;
            salaPinnedScreenParticipantId?: unknown;
          };
          setSelectedSalaId(
            typeof parsedSalaView.selectedSalaId === "number" && Number.isFinite(parsedSalaView.selectedSalaId)
              ? parsedSalaView.selectedSalaId
              : null,
          );
          setSalasParticipantsOpen(parsedSalaView.salasParticipantsOpen === true);
          setSalasChatOpen(parsedSalaView.salasChatOpen !== false);
          setSalasSharedScreensOpen(parsedSalaView.salasSharedScreensOpen !== false);
          setSalaPinnedScreenParticipantId(
            typeof parsedSalaView.salaPinnedScreenParticipantId === "number" &&
              Number.isFinite(parsedSalaView.salaPinnedScreenParticipantId)
              ? parsedSalaView.salaPinnedScreenParticipantId
              : null,
          );
        } catch {
          localStorage.removeItem(dashboardSalaViewKey(parsed.id));
        }
      }
      salaViewHydratedRef.current = true;
    } catch {
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    if (!user || !active) {
      return;
    }
    localStorage.setItem(dashboardSectionKey(user.id), active);
    setUserMenuOpen(false);
    setNotificationPanelOpen(false);
  }, [user, active]);

  useEffect(() => {
    if (!user) {
      return;
    }
    localStorage.setItem(dashboardSidebarOpenKey(user.id), sidebarOpen ? "1" : "0");
  }, [user, sidebarOpen]);

  useEffect(() => {
    groupPracticeRestoreTriedRef.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (!user || !active || !dashboardHistoryHydratedRef.current || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (url.pathname !== "/dashboard") {
      return;
    }

    const currentSection = (url.searchParams.get("section") ?? "").trim().toLowerCase();
    if (currentSection === active) {
      if (skipNextHistoryPushRef.current) {
        skipNextHistoryPushRef.current = false;
      }
      if (syncingHistoryPopRef.current) {
        syncingHistoryPopRef.current = false;
      }
      return;
    }

    url.searchParams.set("section", active);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const historyState =
      typeof window.history.state === "object" && window.history.state != null
        ? (window.history.state as Record<string, unknown>)
        : {};

    if (skipNextHistoryPushRef.current || syncingHistoryPopRef.current) {
      skipNextHistoryPushRef.current = false;
      syncingHistoryPopRef.current = false;
      window.history.replaceState({ ...historyState, smartlearnSection: active }, "", nextUrl);
      return;
    }

    window.history.pushState({ ...historyState, smartlearnSection: active }, "", nextUrl);
  }, [user, active]);

  useEffect(() => {
    if (!user || !active || !courseHistoryHydratedRef.current || typeof window === "undefined") {
      return;
    }
    if (active !== "cursos") {
      return;
    }
    const url = new URL(window.location.href);
    if (url.pathname !== "/dashboard") {
      return;
    }

    const currentCourseIdRaw = (url.searchParams.get("courseId") ?? "").trim();
    const currentCourseIdNumber = Number(currentCourseIdRaw);
    const currentCourseId =
      Number.isFinite(currentCourseIdNumber) && currentCourseIdNumber > 0 ? Math.trunc(currentCourseIdNumber) : null;
    const currentCourseTabRaw = (url.searchParams.get("courseTab") ?? "").trim().toLowerCase();
    const currentCourseTab =
      currentCourseTabRaw === "participantes" ||
      currentCourseTabRaw === "calificaciones" ||
      currentCourseTabRaw === "competencias"
        ? currentCourseTabRaw
        : "curso";
    const targetCourseId = openedCourseId;
    const targetCourseTab = openedCourseTab;

    const sameCourseId = currentCourseId === targetCourseId;
    const sameCourseTab = targetCourseId == null || currentCourseTab === targetCourseTab;
    if (sameCourseId && sameCourseTab) {
      if (skipNextCourseHistoryPushRef.current) {
        skipNextCourseHistoryPushRef.current = false;
      }
      if (syncingCourseHistoryPopRef.current) {
        syncingCourseHistoryPopRef.current = false;
      }
      return;
    }

    if (targetCourseId != null) {
      url.searchParams.set("courseId", String(targetCourseId));
      url.searchParams.set("courseTab", targetCourseTab);
    } else {
      url.searchParams.delete("courseId");
      url.searchParams.delete("courseTab");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const historyState =
      typeof window.history.state === "object" && window.history.state != null
        ? (window.history.state as Record<string, unknown>)
        : {};

    if (skipNextCourseHistoryPushRef.current || syncingCourseHistoryPopRef.current) {
      skipNextCourseHistoryPushRef.current = false;
      syncingCourseHistoryPopRef.current = false;
      window.history.replaceState(
        { ...historyState, smartlearnSection: active, smartlearnCourseId: targetCourseId, smartlearnCourseTab: targetCourseTab },
        "",
        nextUrl,
      );
      return;
    }

    window.history.pushState(
      { ...historyState, smartlearnSection: active, smartlearnCourseId: targetCourseId, smartlearnCourseTab: targetCourseTab },
      "",
      nextUrl,
    );
  }, [user, active, openedCourseId, openedCourseTab]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }
    const admin = isAdminSessionUser(user);
    const allowedSections = new Set((admin ? adminMenu : portalMenu).map((item) => item.key));
    const onPopState = () => {
      const url = new URL(window.location.href);
      if (url.pathname !== "/dashboard") {
        return;
      }
      const sectionFromUrl = (url.searchParams.get("section") ?? "").trim().toLowerCase();
      let resolvedSection = active;
      if (sectionFromUrl && allowedSections.has(sectionFromUrl)) {
        resolvedSection = sectionFromUrl;
        if (sectionFromUrl !== active) {
          syncingHistoryPopRef.current = true;
          setActive(sectionFromUrl);
        }
      }

      if (resolvedSection === "cursos") {
        const rawCourseId = (url.searchParams.get("courseId") ?? "").trim();
        const parsedCourseId = Number(rawCourseId);
        const nextCourseId = Number.isFinite(parsedCourseId) && parsedCourseId > 0 ? Math.trunc(parsedCourseId) : null;
        const rawCourseTab = (url.searchParams.get("courseTab") ?? "").trim().toLowerCase();
        const nextCourseTab =
          rawCourseTab === "participantes" || rawCourseTab === "calificaciones" || rawCourseTab === "competencias"
            ? rawCourseTab
            : "curso";
        const shouldSyncCourse =
          nextCourseId !== openedCourseId || (nextCourseId != null && nextCourseTab !== openedCourseTab);
        if (shouldSyncCourse) {
          syncingCourseHistoryPopRef.current = true;
          setOpenedCourseId(nextCourseId);
          setOpenedCourseTab(nextCourseId == null ? "curso" : nextCourseTab);
          if (nextCourseId == null) {
            setExpandedSessionId(null);
          }
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [user, active, openedCourseId, openedCourseTab]);

  useEffect(() => {
    if (!user || !courseViewHydratedRef.current) {
      return;
    }
    localStorage.setItem(
      dashboardCourseViewKey(user.id),
      JSON.stringify({
        openedCourseId,
        openedCourseTab,
        expandedSessionId,
      }),
    );
  }, [user, openedCourseId, openedCourseTab, expandedSessionId]);

  useEffect(() => {
    if (!user || !salaViewHydratedRef.current) {
      return;
    }
    localStorage.setItem(
      dashboardSalaViewKey(user.id),
      JSON.stringify({
        selectedSalaId,
        salasParticipantsOpen,
        salasChatOpen,
        salasSharedScreensOpen,
        salaPinnedScreenParticipantId,
      }),
    );
  }, [user, selectedSalaId, salasParticipantsOpen, salasChatOpen, salasSharedScreensOpen, salaPinnedScreenParticipantId]);

  useEffect(() => {
    if (!user) {
      return;
    }
    setProfileName(user.name ?? "");
    setProfileUsername(user.username ?? "");
    setProfileEmail(user.email ?? "");
    const userScale = Number(user.profileImageScale ?? 1);
    const userOffsetX = Number(user.profileImageOffsetX ?? 0);
    const normalizedUserScale = Number.isFinite(userScale) ? Math.min(3, Math.max(1, userScale)) : 1;
    const normalizedUserOffsetX = Number.isFinite(userOffsetX) ? clampProfileImageOffsetX(userOffsetX, normalizedUserScale) : 0;
    const normalizedUserOffsetY = 0;
    let nextImageData = typeof user.profileImageData === "string" && user.profileImageData.trim()
      ? user.profileImageData.trim()
      : null;
    let nextScale = normalizedUserScale;
    let nextOffsetX = normalizedUserOffsetX;
    let nextOffsetY = normalizedUserOffsetY;
    try {
      const rawStoredImage = localStorage.getItem(dashboardProfileImageKey(user.id));
      // No mostrar cache local si el servidor no tiene foto: evita casos donde solo
      // el usuario actual ve su imagen pero el resto no.
      if (rawStoredImage && nextImageData == null) {
        localStorage.removeItem(dashboardProfileImageKey(user.id));
      }
    } catch {
      localStorage.removeItem(dashboardProfileImageKey(user.id));
    }
    setProfileImageData(nextImageData);
    setProfileImageScale(nextScale);
    setProfileImageOffsetX(nextOffsetX);
    setProfileImageOffsetY(nextOffsetY);
    setProfileImageDraftData(nextImageData);
    setProfileImageDraftScale(nextScale);
    setProfileImageDraftOffsetX(nextOffsetX);
    setProfileImageDraftOffsetY(nextOffsetY);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    const syncSessionProfile = async () => {
      try {
        const session = (await fetchJson("/api/v1/auth/session", user.token)) as Partial<SessionUser>;
        if (cancelled || !session || typeof session !== "object") {
          return;
        }

        const nextImageData =
          typeof session.profileImageData === "string" && session.profileImageData.trim()
            ? session.profileImageData.trim()
            : null;
        const sessionScale = Number(session.profileImageScale ?? 1);
        const sessionOffsetX = Number(session.profileImageOffsetX ?? 0);
        const normalizedScale = Number.isFinite(sessionScale) ? Math.min(3, Math.max(1, sessionScale)) : 1;
        const normalizedOffsetX = Number.isFinite(sessionOffsetX) ? clampProfileImageOffsetX(sessionOffsetX, normalizedScale) : 0;
        const nextScale = nextImageData == null ? 1 : normalizedScale;
        const nextOffsetX = nextImageData == null ? 0 : normalizedOffsetX;
        const nextOffsetY = 0;
        const nextRoles = Array.isArray(session.roles)
          ? session.roles.filter((role): role is string => typeof role === "string" && role.trim().length > 0)
          : user.roles;

        const nextUser: SessionUser = {
          ...user,
          name: typeof session.name === "string" && session.name.trim() ? session.name.trim() : user.name,
          username: typeof session.username === "string" && session.username.trim() ? session.username.trim() : user.username,
          email: typeof session.email === "string" && session.email.trim() ? session.email.trim() : user.email,
          roles: nextRoles.length > 0 ? nextRoles : user.roles,
          authProvider: typeof session.authProvider === "string" ? session.authProvider : user.authProvider,
          hasLocalPassword:
            typeof session.hasLocalPassword === "boolean" ? session.hasLocalPassword : user.hasLocalPassword,
          profileImageData: nextImageData,
          profileImageScale: nextScale,
          profileImageOffsetX: nextOffsetX,
          profileImageOffsetY: nextOffsetY,
        };

        const changed =
          nextUser.name !== user.name ||
          nextUser.username !== user.username ||
          nextUser.email !== user.email ||
          JSON.stringify(nextUser.roles) !== JSON.stringify(user.roles) ||
          nextUser.authProvider !== user.authProvider ||
          nextUser.hasLocalPassword !== user.hasLocalPassword ||
          nextUser.profileImageData !== user.profileImageData ||
          Number(nextUser.profileImageScale ?? 1) !== Number(user.profileImageScale ?? 1) ||
          Number(nextUser.profileImageOffsetX ?? 0) !== Number(user.profileImageOffsetX ?? 0) ||
          Number(nextUser.profileImageOffsetY ?? 0) !== Number(user.profileImageOffsetY ?? 0);

        if (!changed) {
          return;
        }

        setUser(nextUser);
        localStorage.setItem("smartlearn_user", JSON.stringify(nextUser));
        if (nextImageData == null) {
          localStorage.removeItem(dashboardProfileImageKey(user.id));
        } else {
          localStorage.setItem(
            dashboardProfileImageKey(user.id),
            JSON.stringify({
              imageData: nextImageData,
              scale: nextScale,
              offsetX: nextOffsetX,
              offsetY: nextOffsetY,
            }),
          );
        }
      } catch {
        // Best effort sync; keep local session snapshot when API sync fails.
      }
    };

    void syncSessionProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isAdmin = useMemo(() => {
    if (!user) {
      return false;
    }
    return isAdminSessionUser(user);
  }, [user]);

  const profileRequiresCurrentPassword = useMemo(() => {
    if (!user) {
      return true;
    }
    const provider = (user.authProvider ?? "").trim().toLowerCase();
    const hasLocalPassword = user.hasLocalPassword !== false;
    return !(provider === "google" && !hasLocalPassword);
  }, [user]);

  const profileImagePreviewStyle = useMemo(
    () => ({
      transform: `translate(${profileImageOffsetX}%, 0%) scale(${profileImageScale})`,
      transformOrigin: "center center" as const,
    }),
    [profileImageOffsetX, profileImageScale],
  );

  const profileImageDraftPreviewStyle = useMemo(
    () => ({
      transform: `translate(${profileImageDraftOffsetX}%, 0%) scale(${profileImageDraftScale})`,
      transformOrigin: "center center" as const,
    }),
    [profileImageDraftOffsetX, profileImageDraftScale],
  );

  const menu = isAdmin ? adminMenu : portalMenu;
  const activeTutorialGuide = useMemo(() => resolveTutorialGuide(active || "inicio"), [active]);
  const activeTutorialVideoId = useMemo(
    () => extractYoutubeVideoId(activeTutorialGuide.youtubeUrl),
    [activeTutorialGuide.youtubeUrl],
  );
  const activeTutorialEmbedUrl = activeTutorialVideoId
    ? `https://www.youtube.com/embed/${activeTutorialVideoId}`
    : null;
  const unreadNotificationsCount = useMemo(
    () => homeShareNotifications.reduce((count, notification) => (!notification.readAt ? count + 1 : count), 0),
    [homeShareNotifications],
  );
  const quickHeaderNotifications = useMemo(() => homeShareNotifications.slice(0, 12), [homeShareNotifications]);
  const unreadNotificationsBadgeLabel =
    unreadNotificationsCount > 99 ? "99+" : String(unreadNotificationsCount);

  const loadHomeShareNotifications = useCallback(async () => {
    if (!user) {
      return;
    }
    setHomeShareNotificationsLoading(true);
    try {
      const data = await fetchJson(`/api/v1/share-links/notifications?userId=${user.id}`, user.token);
      const notifications = Array.isArray(data) ? data.filter((item) => isShareNotificationPayload(item)) : [];
      setHomeShareNotifications(notifications);
    } catch {
      setHomeShareNotifications([]);
    } finally {
      setHomeShareNotificationsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const loadSection = async () => {
      if (!user || !active) {
        return;
      }

      setLoading(true);
      setError("");

      try {
        const userId = user.id;
        const token = user.token;

        if (isAdmin && active === "dashboard") {
          const [users, projects, tasks] = await Promise.all([
            fetchJson(`/api/v1/users?requesterUserId=${userId}`, token),
            fetchJson(`/api/v1/projects?requesterUserId=${userId}`, token),
            fetchJson(`/api/v1/tasks?requesterUserId=${userId}`, token),
          ]);
          setPayload({ users, projects, tasks });
          return;
        }

        if (active === "users") {
          setPayload(await fetchJson(`/api/v1/users?requesterUserId=${userId}`, token));
          return;
        }
        if (active === "projects") {
          setPayload(await fetchJson(`/api/v1/projects?requesterUserId=${userId}`, token));
          return;
        }
        if (active === "tasks") {
          setPayload(await fetchJson(`/api/v1/tasks?requesterUserId=${userId}`, token));
          return;
        }
        if (active === "ia") {
          setPayload(await fetchJson(`/api/v1/ia/chats?userId=${userId}`, token));
          return;
        }
        if (active === "examenes") {
          setPayload(await fetchJson(`/api/v1/ia/exams?userId=${userId}`, token));
          return;
        }
        if (active === "cursos") {
          setPayload(await fetchJson(`/api/v1/courses?userId=${userId}`, token));
          return;
        }
        if (active === "horarios") {
          const scheduleQuery =
            schedulePreferredProfileId != null && schedulePreferredProfileId > 0
              ? `&scheduleId=${schedulePreferredProfileId}`
              : "";
          setPayload(await fetchJson(`/api/v1/schedules?userId=${userId}${scheduleQuery}`, token));
          return;
        }
        if (active === "salas") {
          setPayload(await fetchJson(`/api/v1/salas?userId=${userId}`, token));
          return;
        }
        if (active === "ayuda" || active === "support") {
          setPayload(await fetchJson(`/api/v1/support/module?userId=${userId}`, token));
          return;
        }
        if (active === "notificaciones") {
          setPayload(await fetchJson(`/api/v1/share-links/notifications?userId=${userId}`, token));
          return;
        }

        setPayload(null);
      } catch (sectionError) {
        const errorMessage = sectionError instanceof Error ? sectionError.message : "";
        if (errorMessage === "Recurso no encontrado") {
          if (active === "notificaciones") {
            setPayload([]);
            setError("");
            return;
          }
          if (active === "ayuda" || active === "support") {
            setPayload({ conversations: [], adminQueue: [], callRequests: [], adminView: isAdmin });
            setError("");
            return;
          }
        }
        if (sectionError instanceof Error) {
          setError(sectionError.message);
        } else {
          setError("No se pudo cargar este modulo.");
        }
      } finally {
        setLoading(false);
      }
    };

    void loadSection();
  }, [active, isAdmin, schedulePreferredProfileId, user]);

  useEffect(() => {
    if (active !== "horarios") {
      return;
    }
    const scheduleModule = parseScheduleModulePayload(payload);
    const resolvedProfileId =
      typeof scheduleModule.profileId === "number" && scheduleModule.profileId > 0 ? scheduleModule.profileId : null;
    const profilesById = new Map<number, ScheduleProfileOption>();
    scheduleModule.profiles.forEach((profile) => {
      const normalizedId = Math.trunc(profile.profileId);
      if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
        return;
      }
      profilesById.set(normalizedId, {
        ...profile,
        profileId: normalizedId,
        profileName: profile.profileName?.trim() || "Horario",
        accessRole: (profile.accessRole?.trim() || "viewer").toLowerCase(),
      });
    });
    if (resolvedProfileId != null && !profilesById.has(resolvedProfileId)) {
      profilesById.set(resolvedProfileId, {
        profileId: resolvedProfileId,
        profileName: scheduleModule.profileName?.trim() || "Mi horario",
        ownerUserId:
          typeof scheduleModule.ownerUserId === "number" && scheduleModule.ownerUserId > 0
            ? scheduleModule.ownerUserId
            : null,
        accessRole: (scheduleModule.accessRole?.trim() || "owner").toLowerCase(),
        canEdit: scheduleModule.canEdit !== false,
        canShare: scheduleModule.canShare === true,
        createdAt: scheduleModule.createdAt,
      });
    }
    const availableProfiles = Array.from(profilesById.values());
    setScheduleProfiles(availableProfiles);
    setSchedulePreferredProfileId((current) => {
      if (current != null && availableProfiles.some((profile) => profile.profileId === current)) {
        return current;
      }
      return resolvedProfileId;
    });

    setScheduleProfileId(resolvedProfileId);
    setScheduleProfileName(scheduleModule.profileName?.trim() || "Mi horario");
    setScheduleAccessRole((scheduleModule.accessRole?.trim() || "owner").toLowerCase());
    setScheduleOwnerUserId(
      typeof scheduleModule.ownerUserId === "number" && scheduleModule.ownerUserId > 0
        ? scheduleModule.ownerUserId
        : null,
    );
    setScheduleCanEdit(scheduleModule.canEdit !== false);
    setScheduleCanShare(scheduleModule.canShare === true);
    setScheduleReferenceImageData(scheduleModule.referenceImageData?.trim() || null);
    setScheduleReferenceImageName(scheduleModule.referenceImageName?.trim() || "");
    setScheduleActivities(
      scheduleModule.activities.map((activity) => ({
        ...activity,
        day: normalizeScheduleDayKey(activity.day),
        color: normalizeScheduleColorKey(activity.color),
      })),
    );
  }, [active, payload]);

  useEffect(() => {
    if (active !== "salas") {
      return;
    }
    const salaModule = parseSalaModulePayload(payload);
    setSalasData(salaModule.salas);
    setSelectedSalaId((current) => {
      if (current != null && salaModule.salas.some((room) => room.id === current)) {
        return current;
      }
      const preferredId =
        typeof salaModule.selectedSalaId === "number" && Number.isFinite(salaModule.selectedSalaId)
          ? Math.trunc(salaModule.selectedSalaId)
          : null;
      if (preferredId != null && salaModule.salas.some((room) => room.id === preferredId)) {
        return preferredId;
      }
      return null;
    });
  }, [active, payload]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadHomeShareNotifications();
    const intervalId = window.setInterval(() => {
      void loadHomeShareNotifications();
    }, 20 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user, loadHomeShareNotifications]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        await postJson("/api/v1/auth/heartbeat", user.token, {});
      } catch {
        // Best effort presence update.
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    if (active !== "users" || !user) {
      return;
    }

    const refreshUsers = async () => {
      try {
        const users = await fetchJson(`/api/v1/users?requesterUserId=${user.id}`, user.token);
        setPayload(users);
      } catch {
        // Keep last known users list if refresh fails.
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshUsers();
    }, 30 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, user]);

  useEffect(() => {
    if (!user || !shareTokenFromUrl) {
      return;
    }

    if (claimedShareTokenRef.current === shareTokenFromUrl) {
      return;
    }
    claimedShareTokenRef.current = shareTokenFromUrl;

    const clearShareQuery = () => {
      if (typeof window === "undefined") {
        return;
      }
      const url = new URL(window.location.href);
      if (!url.searchParams.has("share")) {
        return;
      }
      url.searchParams.delete("share");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const claimShareLink = async () => {
      try {
        const result = (await postJson("/api/v1/share-links/claim", user.token, {
          userId: user.id,
          token: shareTokenFromUrl,
        })) as ShareLinkClaimResponse;

        clearShareQuery();

        if (result.resourceType === "exam") {
          const exams = (await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[];
          setClaimedExamInvitePrompt({
            examId: result.resourceId,
            examName: result.resourceName?.trim() || "Examen",
            message: result.message?.trim() || "Examen compartido agregado a tu lista.",
            cachedExams: exams,
          });
          setActive("inicio");
          void loadHomeShareNotifications();
          return;
        }

        if (result.resourceType === "course") {
          const courses = await fetchJson(`/api/v1/courses?userId=${user.id}`, user.token);
          setPayload(courses);
          setActive("cursos");
          if (Number.isFinite(result.resourceId) && result.resourceId > 0) {
            setOpenedCourseId(result.resourceId);
            setOpenedCourseTab("curso");
          }
          setCourseFeedback(result.message?.trim() || "Curso compartido agregado a tu lista.", "success");
          return;
        }

        if (result.resourceType === "schedule") {
          const resolvedScheduleId =
            Number.isFinite(result.resourceId) && result.resourceId > 0 ? result.resourceId : null;
          if (resolvedScheduleId != null) {
            setSchedulePreferredProfileId(resolvedScheduleId);
            const scheduleModule = await fetchJson(
              `/api/v1/schedules?userId=${user.id}&scheduleId=${resolvedScheduleId}`,
              user.token,
            );
            setPayload(scheduleModule);
          }
          setActive("horarios");
          setScheduleFeedback(result.message?.trim() || "Horario compartido agregado a tu modulo de horarios.", "success");
          void loadHomeShareNotifications();
          return;
        }

        if (result.resourceType === "sala") {
          setActive("salas");
          if (Number.isFinite(result.resourceId) && result.resourceId > 0) {
            setSelectedSalaId(result.resourceId);
          }
          setSalaFeedback(result.message?.trim() || "Sala compartida lista en tu modulo de salas.", "success");
          return;
        }

        setError("No se pudo identificar el recurso compartido.");
      } catch (claimError) {
        clearShareQuery();
        if (claimError instanceof Error) {
          setError(claimError.message);
        } else {
          setError("No se pudo reclamar el enlace compartido.");
        }
      }
    };

    void claimShareLink();
  }, [shareTokenFromUrl, user, loadHomeShareNotifications]);

  const clearSessionStorage = useCallback((sessionUser: SessionUser | null) => {
    if (sessionUser) {
      localStorage.removeItem(dashboardSectionKey(sessionUser.id));
      localStorage.removeItem(dashboardIaChatKey(sessionUser.id));
      localStorage.removeItem(dashboardCourseViewKey(sessionUser.id));
      localStorage.removeItem(dashboardSalaViewKey(sessionUser.id));
      localStorage.removeItem(dashboardGroupPracticeViewKey(sessionUser.id));
      localStorage.removeItem(dashboardSidebarOpenKey(sessionUser.id));
    }
    localStorage.removeItem("smartlearn_token");
    localStorage.removeItem("smartlearn_user");
  }, []);

  const expireSession = useCallback(
    (reason: "inactive" | "unauthorized") => {
      if (sessionExpiredHandledRef.current) {
        return;
      }
      sessionExpiredHandledRef.current = true;
      setUserMenuOpen(false);
      setNotificationPanelOpen(false);
      clearSessionStorage(user);
      setSessionExpiredMessage(
        reason === "inactive"
          ? `Tu sesion se cerro por inactividad de ${SESSION_INACTIVITY_TIMEOUT_LABEL}.`
          : "Tu sesion expiro. Inicia sesion nuevamente.",
      );
      setSessionExpiredModalOpen(true);
      if (inactivityTimerRef.current != null) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (inactivityIntervalRef.current != null) {
        window.clearInterval(inactivityIntervalRef.current);
        inactivityIntervalRef.current = null;
      }
    },
    [clearSessionStorage, user],
  );

  const onLogout = useCallback(() => {
    setUserMenuOpen(false);
    setNotificationPanelOpen(false);
    clearSessionStorage(user);
    if (typeof window !== "undefined") {
      window.location.replace("/");
      return;
    }
    router.replace("/");
  }, [clearSessionStorage, router, user]);

  const onConfirmExpiredSession = useCallback(() => {
    setSessionExpiredModalOpen(false);
    if (typeof window !== "undefined") {
      window.location.replace("/");
      return;
    }
    router.replace("/");
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onSessionExpired = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason?: "inactive" | "unauthorized" }>;
      const reason = customEvent.detail?.reason === "inactive" ? "inactive" : "unauthorized";
      expireSession(reason);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT_NAME, onSessionExpired as EventListener);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT_NAME, onSessionExpired as EventListener);
    };
  }, [expireSession]);

  useEffect(() => {
    if (!user || sessionExpiredModalOpen || typeof window === "undefined") {
      return;
    }

    const checkInactivity = () => {
      const elapsed = Date.now() - lastActivityAtRef.current;
      if (elapsed >= SESSION_INACTIVITY_TIMEOUT_MS) {
        expireSession("inactive");
      }
    };

    const resetInactivityTimer = () => {
      lastActivityAtRef.current = Date.now();
      if (inactivityTimerRef.current != null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(() => {
        expireSession("inactive");
      }, SESSION_INACTIVITY_TIMEOUT_MS);
    };

    resetInactivityTimer();
    if (inactivityIntervalRef.current != null) {
      window.clearInterval(inactivityIntervalRef.current);
    }
    inactivityIntervalRef.current = window.setInterval(checkInactivity, 5000);

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "pointerdown",
      "keydown",
      "touchstart",
      "touchmove",
      "wheel",
      "scroll",
    ];
    events.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer);
    });
    window.addEventListener("focus", resetInactivityTimer);

    return () => {
      if (inactivityTimerRef.current != null) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (inactivityIntervalRef.current != null) {
        window.clearInterval(inactivityIntervalRef.current);
        inactivityIntervalRef.current = null;
      }
      events.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer);
      });
      window.removeEventListener("focus", resetInactivityTimer);
    };
  }, [expireSession, sessionExpiredModalOpen, user]);

  const setExamFeedback = (message: string, type: "info" | "success" | "error") => {
    setExamMessage(message);
    setExamMessageType(type);
  };

  useEffect(() => {
    if (!examMessage) {
      return;
    }
    const timeoutHandle = window.setTimeout(() => {
      setExamMessage("");
    }, 3000);
    return () => {
      window.clearTimeout(timeoutHandle);
    };
  }, [examMessage]);

  const setUserFeedback = (message: string, type: "info" | "success" | "error") => {
    setUserMessage(message);
    setUserMessageType(type);
  };

  const setCourseFeedback = (message: string, type: "info" | "success" | "error") => {
    setCourseMessage(message);
    setCourseMessageType(type);
  };

  const setSalaFeedback = (message: string, type: "info" | "success" | "error") => {
    setSalaMessage(message);
    setSalaMessageType(type);
  };

  const reloadSalas = useCallback(
    async (preferredSalaId?: number) => {
      if (!user) {
        return parseSalaModulePayload(null);
      }
      const normalizedPreferredId =
        typeof preferredSalaId === "number" && Number.isFinite(preferredSalaId) && preferredSalaId > 0
          ? Math.trunc(preferredSalaId)
          : null;
      const query = normalizedPreferredId != null ? `&salaId=${normalizedPreferredId}` : "";
      const response = await fetchJson(`/api/v1/salas?userId=${user.id}${query}`, user.token);
      setPayload(response);
      return parseSalaModulePayload(response);
    },
    [user],
  );

  const setScheduleFeedback = (message: string, type: "info" | "success" | "error") => {
    setScheduleMessage(message);
    setScheduleMessageType(type);
  };

  const setSupportFeedback = (message: string, type: "info" | "success" | "error") => {
    setSupportMessage(message);
    setSupportMessageType(type);
  };

  const reloadSupportModule = useCallback(async () => {
    if (!user) {
      return;
    }
    const supportModulePayload = await fetchJson(`/api/v1/support/module?userId=${user.id}`, user.token);
    setPayload(supportModulePayload);
  }, [user]);

  useEffect(() => {
    if (active !== "ayuda" && active !== "support") {
      return;
    }
    const supportModule = parseSupportModulePayload(payload);
    const availableIds = new Set<number>();
    supportModule.conversations.forEach((conversation) => {
      availableIds.add(conversation.id);
    });
    if (supportModule.adminView) {
      supportModule.adminQueue.forEach((conversation) => {
        availableIds.add(conversation.id);
      });
    }

    if (availableIds.size === 0) {
      setSupportSelectedConversationId(null);
      setSupportMessages([]);
      return;
    }

    setSupportSelectedConversationId((current) => {
      if (current != null && availableIds.has(current)) {
        return current;
      }
      return Array.from(availableIds)[0] ?? null;
    });
  }, [active, payload]);

  useEffect(() => {
    if (!user || supportSelectedConversationId == null) {
      return;
    }
    if (active !== "ayuda" && active !== "support") {
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      setSupportLoadingMessages(true);
      try {
        const response = await fetchJson(
          `/api/v1/support/conversations/${supportSelectedConversationId}/messages?userId=${user.id}`,
          user.token,
        );
        if (cancelled) {
          return;
        }
        const parsed = Array.isArray(response) ? response.filter((item) => isSupportMessagePayload(item)) : [];
        setSupportMessages(parsed);
      } catch (supportError) {
        if (cancelled) {
          return;
        }
        if (supportError instanceof Error) {
          setSupportFeedback(supportError.message, "error");
        } else {
          setSupportFeedback("No se pudo cargar la conversacion de soporte.", "error");
        }
        setSupportMessages([]);
      } finally {
        if (!cancelled) {
          setSupportLoadingMessages(false);
        }
      }
    };
    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [active, supportSelectedConversationId, user]);

  const scheduleSlots = useMemo(() => buildScheduleSlots(7, 15, 60), []);
  const scheduleWeekDays = SCHEDULE_DAY_OPTIONS;

  const reloadSchedules = useCallback(
    async (preferredScheduleId?: number) => {
      if (!user) {
        return null;
      }
      const normalizedPreferredId =
        typeof preferredScheduleId === "number" && Number.isFinite(preferredScheduleId) && preferredScheduleId > 0
          ? Math.trunc(preferredScheduleId)
          : null;
      const query = normalizedPreferredId != null ? `&scheduleId=${normalizedPreferredId}` : "";
      const response = await fetchJson(`/api/v1/schedules?userId=${user.id}${query}`, user.token);
      setPayload(response);
      return parseScheduleModulePayload(response);
    },
    [user],
  );

  const selectedScheduleProfileId =
    schedulePreferredProfileId != null && schedulePreferredProfileId > 0
      ? schedulePreferredProfileId
      : scheduleProfileId != null && scheduleProfileId > 0
        ? scheduleProfileId
        : null;

  const onSelectScheduleProfile = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextProfileId = Number(event.target.value);
    if (!Number.isFinite(nextProfileId) || nextProfileId <= 0) {
      return;
    }
    if (selectedScheduleProfileId === nextProfileId) {
      return;
    }
    setSchedulePreferredProfileId(Math.trunc(nextProfileId));
    setScheduleActionMenuId(null);
    setEditingScheduleId(null);
    setScheduleFeedback("Cargando horario seleccionado...", "info");
  };

  const scheduleProfileSelectValue = selectedScheduleProfileId != null ? String(selectedScheduleProfileId) : "";

  const onScheduleReferenceImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      setScheduleReferenceImageData(null);
      setScheduleReferenceImageName("");
      return;
    }

    const maxBytes = 8 * 1024 * 1024;
    if (selectedFile.size > maxBytes) {
      setScheduleReferenceImageData(null);
      setScheduleReferenceImageName("");
      setScheduleFeedback("La imagen del horario debe pesar maximo 8 MB.", "error");
      event.currentTarget.value = "";
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(selectedFile);
      setScheduleReferenceImageData(dataUrl);
      setScheduleReferenceImageName(selectedFile.name);
      setScheduleFeedback("Imagen de referencia cargada.", "success");
    } catch {
      setScheduleReferenceImageData(null);
      setScheduleReferenceImageName("");
      setScheduleFeedback("No se pudo leer la imagen del horario.", "error");
    }
  };

  const onCreateScheduleActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }
    if (scheduleProfileId == null) {
      setScheduleFeedback("No se encontro el horario activo.", "error");
      return;
    }
    if (!scheduleCanEdit) {
      setScheduleFeedback("Tu rol es de solo lectura en este horario.", "error");
      return;
    }

    const title = scheduleFormTitle.trim();
    const description = scheduleFormDescription.trim();
    const location = scheduleFormLocation.trim();

    if (!title) {
      setScheduleFeedback("Ingresa el nombre de la actividad.", "error");
      return;
    }

    const normalizedStartTime = normalizeScheduleTimeFromForm(scheduleFormStartTime, scheduleFormStartMeridiem);
    const normalizedEndTime = normalizeScheduleTimeFromForm(scheduleFormEndTime, scheduleFormEndMeridiem);
    if (!normalizedStartTime || !normalizedEndTime) {
      setScheduleFeedback("Usa un formato de hora valido. Ejemplo: 08:30 AM o 14:30.", "error");
      return;
    }

    const startMinutes = timeToMinutes(normalizedStartTime);
    const endMinutes = timeToMinutes(normalizedEndTime);
    if (startMinutes >= endMinutes) {
      setScheduleFeedback("La hora final debe ser mayor que la hora inicial.", "error");
      return;
    }

    setSavingScheduleActivity(true);
    try {
      const body = {
        userId: user.id,
        title,
        description: description || null,
        day: scheduleFormDay,
        startTime: normalizedStartTime,
        endTime: normalizedEndTime,
        location: location || null,
        color: scheduleFormColor,
      };
      if (editingScheduleId != null) {
        await patchJson(`/api/v1/schedules/${scheduleProfileId}/activities/${editingScheduleId}`, user.token, body);
      } else {
        await postJson(`/api/v1/schedules/${scheduleProfileId}/activities`, user.token, body);
      }
      await reloadSchedules(scheduleProfileId);
      setScheduleFeedback(editingScheduleId != null ? "Actividad actualizada." : "Actividad agregada al horario.", "success");
      setScheduleFormTitle("");
      setScheduleFormDescription("");
      setScheduleFormDay("monday");
      setScheduleFormStartTime("08:00");
      setScheduleFormStartMeridiem("AM");
      setScheduleFormEndTime("09:30");
      setScheduleFormEndMeridiem("AM");
      setScheduleFormLocation("");
      setScheduleFormColor("blue");
      setEditingScheduleId(null);
      setScheduleActionMenuId(null);
      setShowCreateScheduleModal(false);
    } catch (scheduleError) {
      if (scheduleError instanceof Error) {
        setScheduleFeedback(scheduleError.message, "error");
      } else {
        setScheduleFeedback("No se pudo guardar la actividad.", "error");
      }
    } finally {
      setSavingScheduleActivity(false);
    }
  };

  const onDeleteScheduleActivity = async (activityId: number) => {
    if (!user) {
      return;
    }
    if (scheduleProfileId == null) {
      setScheduleFeedback("No se encontro el horario activo.", "error");
      return;
    }
    if (!scheduleCanEdit) {
      setScheduleFeedback("Tu rol es de solo lectura en este horario.", "error");
      return;
    }
    setDeletingScheduleActivityId(activityId);
    try {
      await deleteJson(`/api/v1/schedules/${scheduleProfileId}/activities/${activityId}?userId=${user.id}`, user.token);
      await reloadSchedules(scheduleProfileId);
      if (editingScheduleId === activityId) {
        setEditingScheduleId(null);
      }
      setScheduleActionMenuId(null);
      setScheduleFeedback("Actividad eliminada del horario.", "success");
    } catch (scheduleError) {
      if (scheduleError instanceof Error) {
        setScheduleFeedback(scheduleError.message, "error");
      } else {
        setScheduleFeedback("No se pudo eliminar la actividad.", "error");
      }
    } finally {
      setDeletingScheduleActivityId(null);
    }
  };

  const onOpenEditScheduleActivity = (activity: ScheduleActivity) => {
    if (!scheduleCanEdit) {
      setScheduleFeedback("Tu rol es de solo lectura en este horario.", "error");
      return;
    }
    setEditingScheduleId(activity.id);
    setScheduleFormTitle(activity.title);
    setScheduleFormDescription(activity.description);
    setScheduleFormDay(activity.day);
    const startSplit = splitScheduleTimeForForm(activity.startTime);
    if (startSplit) {
      setScheduleFormStartTime(startSplit.time);
      setScheduleFormStartMeridiem(startSplit.meridiem);
    } else {
      setScheduleFormStartTime("08:00");
      setScheduleFormStartMeridiem("AM");
    }
    const endSplit = splitScheduleTimeForForm(activity.endTime);
    if (endSplit) {
      setScheduleFormEndTime(endSplit.time);
      setScheduleFormEndMeridiem(endSplit.meridiem);
    } else {
      setScheduleFormEndTime("09:30");
      setScheduleFormEndMeridiem("AM");
    }
    setScheduleFormLocation(activity.location);
    setScheduleFormColor(activity.color);
    setScheduleActionMenuId(null);
    setShowCreateScheduleModal(true);
  };

  const loadPracticeDraft = (examId: number): PracticeDraft | null => {
    if (!user || typeof window === "undefined") {
      return null;
    }

    const raw = window.localStorage.getItem(practiceDraftKey(user.id, examId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PracticeDraft>;
      const parsedIds = Array.isArray(parsed.questionIds)
        ? parsed.questionIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
        : [];

      const parsedResults: Record<number, PracticeStatus> = {};
      if (parsed.results && typeof parsed.results === "object") {
        Object.entries(parsed.results).forEach(([questionIdRaw, status]) => {
          const questionId = Number(questionIdRaw);
          if (
            Number.isFinite(questionId) &&
            (status === "correct" || status === "incorrect" || status === "unanswered")
          ) {
            parsedResults[questionId] = status;
          }
        });
      }

      return {
        examId,
        questionIds: parsedIds,
        currentIndex:
          typeof parsed.currentIndex === "number" && Number.isFinite(parsed.currentIndex)
            ? Math.max(0, Math.trunc(parsed.currentIndex))
            : 0,
        results: parsedResults,
        startedAt:
          typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt)
            ? parsed.startedAt
            : Date.now(),
      };
    } catch {
      return null;
    }
  };

  const savePracticeDraft = (
    examId: number,
    questionIds: number[],
    currentIndex: number,
    results: Record<number, PracticeStatus>,
    startedAt: number,
  ) => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const draft: PracticeDraft = {
      examId,
      questionIds,
      currentIndex,
      results,
      startedAt,
    };

    window.localStorage.setItem(practiceDraftKey(user.id, examId), JSON.stringify(draft));
  };

  const clearPracticeDraft = (examId: number) => {
    if (!user || typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(practiceDraftKey(user.id, examId));
  };

  const hasOpenPracticeDraft = (examId: number): boolean => {
    const draft = loadPracticeDraft(examId);
    return draft !== null && draft.questionIds.length > 0 && draft.currentIndex < draft.questionIds.length;
  };

  const resetPracticeInputState = () => {
    setPracticeSelectedOption(null);
    setPracticeWrittenAnswer("");
    setPracticeFeedbackStatus(null);
    setGroupDraftQuestionKey(null);
  };

  const resolveCorrectOption = (question: ExamQuestion): "a" | "b" | "c" | "d" => {
    const value = (question.correctOption ?? "a").toLowerCase();
    if (value === "b" || value === "c" || value === "d") {
      return value;
    }
    return "a";
  };

  const normalizeAnswer = (value: string): string => value.trim().toLowerCase();

  const formatClock = (totalSeconds: number): string => {
    const safeValue = Math.max(0, Math.trunc(totalSeconds));
    const minutes = Math.floor(safeValue / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safeValue % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const resetNewUserForm = () => {
    setNewUserFirstName("");
    setNewUserLastName("");
    setNewUserUsername("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserRole("user");
  };

  const resetEditUserForm = () => {
    setEditingUserId(null);
    setEditUserFirstName("");
    setEditUserLastName("");
    setEditUserUsername("");
    setEditUserEmail("");
    setEditUserPassword("");
    setEditUserRole("user");
  };

  const refreshUsers = async () => {
    if (!user) {
      return;
    }
    const users = (await fetchJson(`/api/v1/users?requesterUserId=${user.id}`, user.token)) as AdminUserRow[];
    setPayload(users);
  };

  const refreshCourses = async () => {
    if (!user) {
      return;
    }
    const courses = await fetchJson(`/api/v1/courses?userId=${user.id}`, user.token);
    setPayload(courses);
  };

  const onCreateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const normalizedName = courseName.trim();
    if (!normalizedName) {
      setCourseFeedback("Ingresa el nombre del curso.", "error");
      return;
    }

    setCreatingCourse(true);
    setCourseMessage("");

    try {
      await postJson("/api/v1/courses", user.token, {
        userId: user.id,
        name: normalizedName,
        description: courseDescription.trim() ? courseDescription.trim() : null,
        coverImageData: courseCoverImageData?.trim() ? courseCoverImageData.trim() : null,
        code: courseCode.trim() ? courseCode.trim() : null,
        visibility: courseVisibility,
      });
      setCourseName("");
      setCourseDescription("");
      setCourseCode("");
      setCourseVisibility("public");
      setCourseCoverImageData(null);
      setCourseCoverImageName("");
      setShowCreateCourseModal(false);
      await refreshCourses();
      setCourseFeedback("Curso creado correctamente.", "success");
    } catch (courseCreateError) {
      if (courseCreateError instanceof Error) {
        setCourseFeedback(courseCreateError.message, "error");
      } else {
        setCourseFeedback("No se pudo crear el curso.", "error");
      }
    } finally {
      setCreatingCourse(false);
    }
  };

  const onOpenEditCourse = (course: CourseItem) => {
    setEditingCourseId(course.id);
    setEditingCourseName(course.name);
    setEditingCourseDescription(course.description ?? "");
    setEditingCourseCode(course.code?.trim() ? course.code : "");
    setEditingCourseVisibility(course.visibility === "private" ? "private" : "public");
    setCourseActionMenuId(null);
    setShowEditCourseModal(true);
  };

  const onUpdateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || editingCourseId == null) {
      return;
    }

    const normalizedName = editingCourseName.trim();
    if (!normalizedName) {
      setCourseFeedback("Ingresa el nombre del curso.", "error");
      return;
    }

    setSavingCourseId(editingCourseId);
    setCourseMessage("");

    try {
      await patchJson(`/api/v1/courses/${editingCourseId}`, user.token, {
        userId: user.id,
        name: normalizedName,
        description: editingCourseDescription.trim() ? editingCourseDescription.trim() : null,
        code: editingCourseCode.trim() ? editingCourseCode.trim() : null,
        visibility: editingCourseVisibility,
      });
      await refreshCourses();
      setShowEditCourseModal(false);
      setEditingCourseId(null);
      setEditingCourseName("");
      setEditingCourseDescription("");
      setEditingCourseCode("");
      setEditingCourseVisibility("public");
      setCourseFeedback("Curso actualizado correctamente.", "success");
    } catch (courseUpdateError) {
      if (courseUpdateError instanceof Error) {
        setCourseFeedback(courseUpdateError.message, "error");
      } else {
        setCourseFeedback("No se pudo actualizar el curso.", "error");
      }
    } finally {
      setSavingCourseId(null);
    }
  };

  const onOpenDeleteCourse = (course: CourseItem) => {
    setDeleteCourseTarget(course);
    setCourseActionMenuId(null);
    setShowDeleteCourseModal(true);
  };

  const onConfirmDeleteCourse = async () => {
    if (!user || !deleteCourseTarget) {
      return;
    }

    setDeletingCourseId(deleteCourseTarget.id);
    setCourseMessage("");

    try {
      await deleteJson(`/api/v1/courses/${deleteCourseTarget.id}?userId=${user.id}`, user.token);
      await refreshCourses();
      setCourseFeedback("Curso eliminado correctamente.", "success");
      if (openedCourseId === deleteCourseTarget.id) {
        setOpenedCourseId(null);
      }
      if (managingCourseId === deleteCourseTarget.id) {
        setShowManageCourseModal(false);
        setManagingCourseId(null);
      }
      setShowDeleteCourseModal(false);
      setDeleteCourseTarget(null);
    } catch (courseDeleteError) {
      if (courseDeleteError instanceof Error) {
        setCourseFeedback(courseDeleteError.message, "error");
      } else {
        setCourseFeedback("No se pudo eliminar el curso.", "error");
      }
    } finally {
      setDeletingCourseId(null);
    }
  };

  const onOpenManageCourse = (course: CourseItem) => {
    setManagingCourseId(course.id);
    setManagingCoursePriority(
      course.priority === "very_important" || course.priority === "low_important" || course.priority === "optional"
        ? course.priority
        : "important",
    );
    setManagingCourseSortOrder(String(Math.max(0, Number(course.sortOrder ?? 0) || 0)));
    setCourseActionMenuId(null);
    setShowManageCourseModal(true);
  };

  const onSaveCourseManage = async (course: CourseItem) => {
    if (!user) {
      return;
    }

    const parsedSortOrder = Number(managingCourseSortOrder);
    if (!Number.isFinite(parsedSortOrder) || parsedSortOrder < 0) {
      setCourseFeedback("El orden debe ser un numero mayor o igual a 0.", "error");
      return;
    }

    setSavingCourseId(course.id);
    setCourseMessage("");

    try {
      await patchJson(`/api/v1/courses/${course.id}`, user.token, {
        userId: user.id,
        name: course.name,
        description: course.description?.trim() ? course.description.trim() : null,
        code: course.code?.trim() ? course.code.trim() : null,
        visibility: course.visibility === "private" ? "private" : "public",
        priority: managingCoursePriority,
        sortOrder: Math.trunc(parsedSortOrder),
      });
      await refreshCourses();
      setCourseFeedback("Prioridad y orden del curso actualizados.", "success");
      setShowManageCourseModal(false);
      setManagingCourseId(null);
    } catch (courseSaveError) {
      if (courseSaveError instanceof Error) {
        setCourseFeedback(courseSaveError.message, "error");
      } else {
        setCourseFeedback("No se pudo actualizar la configuracion del curso.", "error");
      }
    } finally {
      setSavingCourseId(null);
    }
  };

  const onCreateCourseSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || openedCourseId == null) {
      return;
    }

    const normalizedSessionName = courseSessionName.trim();
    const currentCourseModule = parseCourseModulePayload(payload);
    const openedCourse = currentCourseModule.courses.find((course) => course.id === openedCourseId) ?? null;
    const nextOrder = getNextSessionOrder(openedCourse?.sessions ?? []);
    const withoutPrefix = normalizedSessionName.replace(/^sesion\s+\d+\s*:\s*/i, "").trim();
    const finalSessionName = `SESION ${nextOrder}: ${withoutPrefix}`;

    if (!withoutPrefix) {
      setCourseFeedback("Completa el nombre despues de SESION " + nextOrder + ":", "error");
      return;
    }

    setCreatingCourseSession(true);
    setCourseMessage("");

    try {
      await postJson(`/api/v1/courses/${openedCourseId}/sessions`, user.token, {
        userId: user.id,
        name: finalSessionName,
        weeklyContent: courseSessionWeeklyContent.trim() ? courseSessionWeeklyContent.trim() : null,
      });
      setCourseSessionName("");
      setCourseSessionWeeklyContent("");
      setShowCreateCourseSessionModal(false);
      await refreshCourses();
      setCourseFeedback("Sesion creada correctamente.", "success");
    } catch (courseSessionError) {
      if (courseSessionError instanceof Error) {
        const rawMessage = courseSessionError.message || "";
        const lowerMessage = rawMessage.toLowerCase();
        if (
          lowerMessage.includes("recurso no encontrado") ||
          lowerMessage.includes("no static resource") ||
          lowerMessage.includes("/sessions")
        ) {
          setCourseFeedback("El backend no esta actualizado. Reinicia SmartLearnApi y vuelve a intentar.", "error");
        } else {
          setCourseFeedback(rawMessage, "error");
        }
      } else {
        setCourseFeedback("No se pudo crear la sesion.", "error");
      }
    } finally {
      setCreatingCourseSession(false);
    }
  };

  const onOpenEditCourseSession = (session: CourseSessionItem) => {
    setEditingCourseSessionId(session.id);
    setEditingCourseSessionName(formatSessionName(session.name));
    setEditingCourseSessionWeeklyContent(session.weeklyContent?.trim() ?? "");
    setShowEditCourseSessionModal(true);
    setCourseMessage("");
  };

  const onUpdateCourseSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || editingCourseSessionId == null) {
      return;
    }

    const currentCourseModule = parseCourseModulePayload(payload);
    const openedCourseContainsSession =
      openedCourseId != null &&
      currentCourseModule.courses.some(
        (course) => course.id === openedCourseId && (course.sessions ?? []).some((session) => session.id === editingCourseSessionId),
      );
    const resolvedCourseId =
      openedCourseContainsSession
        ? openedCourseId
        : (currentCourseModule.courses.find((course) => (course.sessions ?? []).some((session) => session.id === editingCourseSessionId))
            ?.id ??
          null);
    if (resolvedCourseId == null) {
      setCourseFeedback("No se encontro el curso de la sesion.", "error");
      return;
    }

    const normalized = editingCourseSessionName.trim();
    const withoutPrefix = normalized.replace(/^sesion\s+\d+\s*:\s*/i, "").trim();
    const order = parseSessionOrderFromName(normalized) ?? parseSessionOrderFromName(formatSessionName(normalized));
    if (!withoutPrefix) {
      setCourseFeedback("Completa el nombre de la sesion.", "error");
      return;
    }
    if (order == null) {
      setCourseFeedback("El nombre debe mantener formato SESION N: Titulo.", "error");
      return;
    }

    setUpdatingCourseSession(true);
    setCourseMessage("");

    try {
      await patchJson(`/api/v1/courses/${resolvedCourseId}/sessions/${editingCourseSessionId}`, user.token, {
        userId: user.id,
        name: `SESION ${order}: ${withoutPrefix}`,
        weeklyContent: editingCourseSessionWeeklyContent.trim()
          ? editingCourseSessionWeeklyContent.trim()
          : null,
      });
      setShowEditCourseSessionModal(false);
      setEditingCourseSessionId(null);
      setEditingCourseSessionName("");
      setEditingCourseSessionWeeklyContent("");
      if (openedCourseId == null || openedCourseId !== resolvedCourseId) {
        setOpenedCourseId(resolvedCourseId);
      }
      await refreshCourses();
      setCourseFeedback("Sesion actualizada.", "success");
    } catch (courseSessionUpdateError) {
      if (courseSessionUpdateError instanceof Error) {
        setCourseFeedback(courseSessionUpdateError.message, "error");
      } else {
        setCourseFeedback("No se pudo actualizar la sesion.", "error");
      }
    } finally {
      setUpdatingCourseSession(false);
    }
  };

  const resetSessionContentEditor = () => {
    setShowAddSessionContentModal(false);
    setAddingContentSessionId(null);
    setAddingContentSessionName("");
    setEditingSessionContentId(null);
    setSessionContentType("video");
    setSessionContentName("");
    setSessionVideoLink("");
    setSessionCoverImageData(null);
    setSessionPdfFileName("");
    setSessionPdfFileData(null);
    setSessionWordFileName("");
    setSessionWordFileData(null);
    setSessionExamSourceId("");
  };

  const resetCourseCompetencyEditor = () => {
    setCourseCompetencyName("");
    setCourseCompetencyDescription("");
    setCourseCompetencyLevel("basico");
    setCourseCompetencySortOrder("0");
    setEditingCourseCompetencyId(null);
  };

  const onOpenSessionContent = (session: CourseSessionItem) => {
    if (expandedSessionId === session.id) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(session.id);
    setCourseMessage("");
  };

  const onOpenAddSessionContentModal = (session: CourseSessionItem) => {
    setAddingContentSessionId(session.id);
    setAddingContentSessionName(session.name);
    setEditingSessionContentId(null);
    setSessionContentType("video");
    setSessionContentName("");
    setSessionVideoLink("");
    setSessionCoverImageData(null);
    setSessionPdfFileName("");
    setSessionPdfFileData(null);
    setSessionWordFileName("");
    setSessionWordFileData(null);
    setSessionExamSourceId("");
    setShowAddSessionContentModal(true);
    setCourseMessage("");
  };

  const onOpenEditSessionContentModal = (session: CourseSessionItem, content: CourseSessionContentItem) => {
    const normalizedType = (content.type ?? "").toLowerCase();
    const mappedType: "video" | "pdf" | "word" | "portada" | "examen" =
      normalizedType === "pdf"
        ? "pdf"
        : normalizedType === "word"
          ? "word"
          : normalizedType === "exam"
            ? "examen"
          : normalizedType === "cover"
            ? "portada"
            : "video";

    setAddingContentSessionId(session.id);
    setAddingContentSessionName(session.name);
    setEditingSessionContentId(content.id);
    setSessionContentType(mappedType);
    setSessionContentName(content.title?.trim() ?? "");
    setSessionVideoLink(content.externalLink?.trim() ?? "");
    setSessionCoverImageData(null);
    setSessionPdfFileName(content.fileName?.trim() ?? "");
    setSessionPdfFileData(null);
    setSessionWordFileName(content.fileName?.trim() ?? "");
    setSessionWordFileData(null);
    setSessionExamSourceId(content.sourceExamId != null ? String(content.sourceExamId) : "");
    setShowAddSessionContentModal(true);
    setCourseMessage("");
  };

  const onSaveSessionContent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || addingContentSessionId == null) {
      return;
    }

    const currentCourseModule = parseCourseModulePayload(payload);
    const openedCourseContainsSession =
      openedCourseId != null &&
      currentCourseModule.courses.some(
        (course) => course.id === openedCourseId && (course.sessions ?? []).some((session) => session.id === addingContentSessionId),
      );
    const resolvedCourseId =
      openedCourseContainsSession
        ? openedCourseId
        : (currentCourseModule.courses.find((course) => (course.sessions ?? []).some((session) => session.id === addingContentSessionId))
            ?.id ??
          null);
    if (resolvedCourseId == null) {
      setCourseFeedback("No se encontro el curso de la sesion.", "error");
      return;
    }

    setSavingSessionContent(true);
    setCourseMessage("");

    try {
      const body: Record<string, unknown> = { userId: user.id };
      const normalizedContentName = sessionContentName.trim();
      if (!normalizedContentName) {
        setCourseFeedback("Ingresa un nombre para el contenido.", "error");
        return;
      }

      if (sessionContentType === "video") {
        const link = sessionVideoLink.trim();
        if (!link) {
          setCourseFeedback("Ingresa el enlace del video.", "error");
          return;
        }
        body.type = "video";
        body.title = normalizedContentName;
        body.externalLink = link;
      }

      if (sessionContentType === "portada") {
        const data = sessionCoverImageData?.trim() ?? "";
        if (editingSessionContentId == null && !data) {
          setCourseFeedback("Selecciona una portada para la sesion.", "error");
          return;
        }
        body.type = "cover";
        body.title = normalizedContentName;
        if (data) {
          body.fileData = data;
        }
      }

      if (sessionContentType === "pdf") {
        const name = sessionPdfFileName.trim();
        const data = sessionPdfFileData?.trim() ?? "";
        if (editingSessionContentId == null && (!data || !name)) {
          setCourseFeedback("Selecciona un archivo PDF.", "error");
          return;
        }
        body.type = "pdf";
        body.title = normalizedContentName;
        if (name) {
          body.fileName = name;
        }
        if (data) {
          body.fileData = data;
        }
      }

      if (sessionContentType === "word") {
        const name = sessionWordFileName.trim();
        const data = sessionWordFileData?.trim() ?? "";
        if (editingSessionContentId == null && (!data || !name)) {
          setCourseFeedback("Selecciona un archivo Word.", "error");
          return;
        }
        body.type = "word";
        body.title = normalizedContentName;
        if (name) {
          body.fileName = name;
        }
        if (data) {
          body.fileData = data;
        }
      }

      if (sessionContentType === "examen") {
        const sourceExamId = Number(sessionExamSourceId);
        if (!Number.isFinite(sourceExamId) || sourceExamId <= 0) {
          setCourseFeedback("Selecciona un examen para clonar en el contenido.", "error");
          return;
        }
        body.type = "exam";
        body.title = normalizedContentName;
        body.sourceExamId = sourceExamId;
      }

      if (editingSessionContentId == null) {
        await postJson(`/api/v1/courses/${resolvedCourseId}/sessions/${addingContentSessionId}/contents`, user.token, body);
      } else {
        await patchJson(
          `/api/v1/courses/${resolvedCourseId}/sessions/${addingContentSessionId}/contents/${editingSessionContentId}`,
          user.token,
          body,
        );
      }
      if (openedCourseId == null || openedCourseId !== resolvedCourseId) {
        setOpenedCourseId(resolvedCourseId);
      }
      await refreshCourses();
      resetSessionContentEditor();
      setCourseFeedback(editingSessionContentId == null ? "Contenido agregado." : "Contenido actualizado.", "success");
    } catch (sessionContentError) {
      if (sessionContentError instanceof Error) {
        setCourseFeedback(sessionContentError.message, "error");
      } else {
        setCourseFeedback("No se pudo actualizar el contenido de la sesion.", "error");
      }
    } finally {
      setSavingSessionContent(false);
    }
  };

  const onStartPracticeFromCourseSessionContent = async (sessionId: number, content: CourseSessionContentItem) => {
    if (!user) {
      return;
    }

    const currentCourseModule = parseCourseModulePayload(payload);
    const openedCourseContainsSession =
      openedCourseId != null &&
      currentCourseModule.courses.some(
        (course) => course.id === openedCourseId && (course.sessions ?? []).some((session) => session.id === sessionId),
      );
    const resolvedCourseId =
      openedCourseContainsSession
        ? openedCourseId
        : (currentCourseModule.courses.find((course) => (course.sessions ?? []).some((session) => session.id === sessionId))
            ?.id ??
          null);

    if (resolvedCourseId == null) {
      setCourseFeedback("No se encontro el curso para abrir el repaso.", "error");
      return;
    }

    setPracticeOriginSection("cursos");
    setActive("examenes");
    setPracticeIntent("start");

    try {
      const startResponse = (await postJson(
        `/api/v1/courses/${resolvedCourseId}/sessions/${sessionId}/contents/${content.id}/practice/start`,
        user.token,
        { userId: user.id },
      )) as CourseSessionContentPracticeStartResponse;

      const exams = await refreshExams();
      const targetExam = exams.find((item) => item.id === startResponse.examId);
      if (!targetExam) {
        setExamFeedback("No se encontro el examen clonado en tu lista.", "error");
        return;
      }
      if ((targetExam.participantsCount ?? 1) <= 1) {
        await onStartPractice(targetExam, false);
        return;
      }
      setSelectedExam(targetExam);
      setPracticeStartMode("personal");
      setShowPracticeModal(true);
    } catch (startError) {
      if (startError instanceof Error) {
        setExamFeedback(startError.message, "error");
      } else {
        setExamFeedback("No se pudo iniciar el repaso desde el contenido del curso.", "error");
      }
    }
  };

  const onCloseCourseContentPreview = () => {
    if (courseContentPreviewObjectUrl) {
      URL.revokeObjectURL(courseContentPreviewObjectUrl);
    }
    setCourseContentPreviewObjectUrl(null);
    setCourseContentPreviewOpen(false);
    setCourseContentPreviewTitle("");
    setCourseContentPreviewUrl("");
    setCourseContentPreviewType("pdf");
  };

  const resolveYouTubeEmbedUrl = (rawUrl: string): string | null => {
    const normalized = rawUrl.trim();
    if (!normalized) {
      return null;
    }
    try {
      const parsed = new URL(normalized);
      let videoId = "";
      const host = parsed.hostname.toLowerCase();
      if (host.includes("youtu.be")) {
        videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      } else if (host.includes("youtube.com")) {
        videoId = parsed.searchParams.get("v") ?? "";
        if (!videoId && parsed.pathname.includes("/embed/")) {
          videoId = parsed.pathname.split("/embed/")[1]?.split("/")[0] ?? "";
        }
        if (!videoId && parsed.pathname.includes("/shorts/")) {
          videoId = parsed.pathname.split("/shorts/")[1]?.split("/")[0] ?? "";
        }
      }
      if (!videoId) {
        return null;
      }
      return `https://www.youtube.com/embed/${videoId}`;
    } catch {
      return null;
    }
  };

  const dataUrlToObjectUrl = (dataUrl: string): string | null => {
    const normalized = dataUrl.trim();
    const match = normalized.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return null;
    }
    try {
      const mime = match[1];
      const base64Data = match[2];
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return null;
    }
  };

  const onOpenCourseContentPreview = (content: CourseSessionContentItem) => {
    if (courseContentPreviewObjectUrl) {
      URL.revokeObjectURL(courseContentPreviewObjectUrl);
      setCourseContentPreviewObjectUrl(null);
    }

    const type = (content.type ?? "").toLowerCase();
    const title = content.title?.trim() || "Vista previa";
    if (type === "video") {
      const embedUrl = resolveYouTubeEmbedUrl(content.externalLink ?? "");
      if (!embedUrl) {
        setCourseFeedback("No se pudo abrir el video. Verifica el enlace de YouTube.", "error");
        return;
      }
      setCourseContentPreviewType("video");
      setCourseContentPreviewTitle(title);
      setCourseContentPreviewUrl(embedUrl);
      setCourseContentPreviewOpen(true);
      return;
    }

    const fileData = content.fileData?.trim() ?? "";
    if (!fileData) {
      setCourseFeedback("No hay archivo disponible para vista previa.", "error");
      return;
    }
    const objectUrl = fileData.startsWith("data:") ? dataUrlToObjectUrl(fileData) : null;
    const previewUrl = objectUrl ?? fileData;
    if (!previewUrl) {
      setCourseFeedback("No se pudo generar la vista previa del archivo.", "error");
      return;
    }
    if (objectUrl) {
      setCourseContentPreviewObjectUrl(objectUrl);
    }
    setCourseContentPreviewType(type === "pdf" ? "pdf" : "file");
    setCourseContentPreviewTitle(title);
    setCourseContentPreviewUrl(previewUrl);
    setCourseContentPreviewOpen(true);
  };

  const onAddCourseParticipant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || openedCourseId == null) {
      return;
    }

    const normalizedIdentifier = courseParticipantIdentifier.trim();
    if (!normalizedIdentifier) {
      setCourseFeedback("Ingresa correo o username del participante.", "error");
      return;
    }

    setAddingCourseParticipant(true);
    setCourseMessage("");
    try {
      await postJson(`/api/v1/courses/${openedCourseId}/participants`, user.token, {
        userId: user.id,
        identifier: normalizedIdentifier,
        role: courseParticipantRole,
      });
      setCourseParticipantIdentifier("");
      setCourseParticipantRole("viewer");
      await refreshCourses();
      setCourseFeedback("Participante agregado correctamente.", "success");
    } catch (participantError) {
      if (participantError instanceof Error) {
        setCourseFeedback(participantError.message, "error");
      } else {
        setCourseFeedback("No se pudo agregar el participante.", "error");
      }
    } finally {
      setAddingCourseParticipant(false);
    }
  };

  const onUpdateCourseParticipantRole = async (
    participantUserId: number,
    role: "viewer" | "editor" | "assistant",
  ) => {
    if (!user || openedCourseId == null) {
      return;
    }

    setSavingCourseParticipantUserId(participantUserId);
    setCourseMessage("");
    try {
      await patchJson(`/api/v1/courses/${openedCourseId}/participants/${participantUserId}`, user.token, {
        userId: user.id,
        role,
      });
      await refreshCourses();
      setCourseFeedback("Rol de participante actualizado.", "success");
    } catch (participantRoleError) {
      if (participantRoleError instanceof Error) {
        setCourseFeedback(participantRoleError.message, "error");
      } else {
        setCourseFeedback("No se pudo actualizar el rol.", "error");
      }
    } finally {
      setSavingCourseParticipantUserId(null);
    }
  };

  const onRemoveCourseParticipant = async (participantUserId: number) => {
    if (!user || openedCourseId == null) {
      return;
    }

    setSavingCourseParticipantUserId(participantUserId);
    setCourseMessage("");
    try {
      await deleteJson(`/api/v1/courses/${openedCourseId}/participants/${participantUserId}?userId=${user.id}`, user.token);
      await refreshCourses();
      setCourseFeedback("Participante removido del curso.", "success");
    } catch (removeParticipantError) {
      if (removeParticipantError instanceof Error) {
        setCourseFeedback(removeParticipantError.message, "error");
      } else {
        setCourseFeedback("No se pudo remover el participante.", "error");
      }
    } finally {
      setSavingCourseParticipantUserId(null);
    }
  };

  const onSaveCourseCompetency = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || openedCourseId == null) {
      return;
    }

    const normalizedName = courseCompetencyName.trim();
    if (!normalizedName) {
      setCourseFeedback("Ingresa el nombre de la competencia.", "error");
      return;
    }

    const parsedSortOrder = Number(courseCompetencySortOrder);
    if (!Number.isFinite(parsedSortOrder) || parsedSortOrder < 0) {
      setCourseFeedback("El orden de competencia debe ser mayor o igual a 0.", "error");
      return;
    }

    setSavingCourseCompetency(true);
    setCourseMessage("");
    const body = {
      userId: user.id,
      name: normalizedName,
      description: courseCompetencyDescription.trim() ? courseCompetencyDescription.trim() : null,
      level: courseCompetencyLevel,
      sortOrder: Math.trunc(parsedSortOrder),
    };

    try {
      if (editingCourseCompetencyId == null) {
        await postJson(`/api/v1/courses/${openedCourseId}/competencies`, user.token, body);
      } else {
        await patchJson(`/api/v1/courses/${openedCourseId}/competencies/${editingCourseCompetencyId}`, user.token, body);
      }
      await refreshCourses();
      resetCourseCompetencyEditor();
      setCourseFeedback("Competencia guardada correctamente.", "success");
    } catch (competencyError) {
      if (competencyError instanceof Error) {
        setCourseFeedback(competencyError.message, "error");
      } else {
        setCourseFeedback("No se pudo guardar la competencia.", "error");
      }
    } finally {
      setSavingCourseCompetency(false);
    }
  };

  const onEditCourseCompetency = (competency: CourseCompetencyItem) => {
    setEditingCourseCompetencyId(competency.id);
    setCourseCompetencyName(competency.name ?? "");
    setCourseCompetencyDescription(competency.description?.trim() ?? "");
    const normalizedLevel =
      competency.level === "intermedio" || competency.level === "avanzado" ? competency.level : "basico";
    setCourseCompetencyLevel(normalizedLevel);
    setCourseCompetencySortOrder(String(Math.max(0, Number(competency.sortOrder ?? 0) || 0)));
    setCourseMessage("");
  };

  const onDeleteCourseCompetency = async (competencyId: number) => {
    if (!user || openedCourseId == null) {
      return;
    }
    setDeletingCourseCompetencyId(competencyId);
    setCourseMessage("");
    try {
      await deleteJson(`/api/v1/courses/${openedCourseId}/competencies/${competencyId}?userId=${user.id}`, user.token);
      await refreshCourses();
      if (editingCourseCompetencyId === competencyId) {
        resetCourseCompetencyEditor();
      }
      setCourseFeedback("Competencia eliminada.", "success");
    } catch (deleteCompetencyError) {
      if (deleteCompetencyError instanceof Error) {
        setCourseFeedback(deleteCompetencyError.message, "error");
      } else {
        setCourseFeedback("No se pudo eliminar la competencia.", "error");
      }
    } finally {
      setDeletingCourseCompetencyId(null);
    }
  };

  const onCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (
      !newUserFirstName.trim() ||
      !newUserLastName.trim() ||
      !newUserUsername.trim() ||
      !newUserEmail.trim() ||
      !newUserPassword.trim()
    ) {
      setUserFeedback("Completa todos los campos para crear el usuario.", "error");
      return;
    }

    setCreatingUser(true);
    setUserMessage("");

    try {
      await postJson(`/api/v1/users?requesterUserId=${user.id}`, user.token, {
        firstName: newUserFirstName.trim(),
        lastName: newUserLastName.trim(),
        username: newUserUsername.trim(),
        email: newUserEmail.trim().toLowerCase(),
        password: newUserPassword,
        role: newUserRole,
      });
      await refreshUsers();
      resetNewUserForm();
      setShowCreateUserPanel(false);
      setUserPage(1);
      setUserFeedback("Usuario creado correctamente.", "success");
    } catch (createUserError) {
      if (createUserError instanceof Error) {
        setUserFeedback(createUserError.message, "error");
      } else {
        setUserFeedback("No se pudo crear el usuario.", "error");
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const onToggleUserStatus = async (item: AdminUserRow) => {
    if (!user) {
      return;
    }

    const shouldDeactivate = isUserActive(item.status);
    const action = shouldDeactivate ? "deactivate" : "activate";
    const label = shouldDeactivate ? "inactivado" : "activado";

    try {
      await patchJson(`/api/v1/users/${item.id}/${action}?requesterUserId=${user.id}`, user.token, {});
      await refreshUsers();
      setUserFeedback(`Usuario ${label} correctamente.`, "success");
    } catch (toggleError) {
      if (toggleError instanceof Error) {
        setUserFeedback(toggleError.message, "error");
      } else {
        setUserFeedback("No se pudo actualizar el estado del usuario.", "error");
      }
    }
  };

  const onOpenEditUser = (item: AdminUserRow) => {
    const firstNameSource = item.firstName?.trim() ?? "";
    const lastNameSource = item.lastName?.trim() ?? "";
    const nameParts = item.name.trim().split(/\s+/).filter((part) => part.length > 0);
    const fallbackFirstName = nameParts.length > 0 ? nameParts[0] : "";
    const fallbackLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
    const currentRole =
      item.roles && item.roles.some((role) => role.toLowerCase() === "admin") ? "admin" : "user";

    setEditingUserId(item.id);
    setEditUserFirstName(firstNameSource || fallbackFirstName);
    setEditUserLastName(lastNameSource || fallbackLastName);
    setEditUserUsername(item.username);
    setEditUserEmail(item.email);
    setEditUserPassword("");
    setEditUserRole(currentRole);
    setShowEditUserPanel(true);
  };

  const onUpdateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || editingUserId == null) {
      return;
    }

    if (
      !editUserFirstName.trim() ||
      !editUserLastName.trim() ||
      !editUserUsername.trim() ||
      !editUserEmail.trim()
    ) {
      setUserFeedback("Completa los datos obligatorios del usuario.", "error");
      return;
    }

    setUpdatingUser(true);
    try {
      await putJson(`/api/v1/users/${editingUserId}?requesterUserId=${user.id}`, user.token, {
        firstName: editUserFirstName.trim(),
        lastName: editUserLastName.trim(),
        username: editUserUsername.trim(),
        email: editUserEmail.trim().toLowerCase(),
        role: editUserRole,
        password: editUserPassword.trim() ? editUserPassword : undefined,
      });
      await refreshUsers();
      setShowEditUserPanel(false);
      resetEditUserForm();
      setUserFeedback("Usuario actualizado correctamente.", "success");
    } catch (updateError) {
      if (updateError instanceof Error) {
        setUserFeedback(updateError.message, "error");
      } else {
        setUserFeedback("No se pudo actualizar el usuario.", "error");
      }
    } finally {
      setUpdatingUser(false);
    }
  };

  const onSaveProfileInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (!profileName.trim() || !profileUsername.trim() || !profileEmail.trim()) {
      setProfileInfoMessage("Completa nombre, usuario y correo.");
      setProfileInfoMessageType("error");
      return;
    }

    setProfileInfoSaving(true);
    try {
      const nextUser: SessionUser = {
        ...user,
        name: profileName.trim(),
        username: profileUsername.trim(),
        email: profileEmail.trim().toLowerCase(),
      };
      setUser(nextUser);
      localStorage.setItem("smartlearn_user", JSON.stringify(nextUser));
      setProfileInfoMessage("Perfil actualizado.");
      setProfileInfoMessageType("success");
    } catch {
      setProfileInfoMessage("No se pudo actualizar el perfil.");
      setProfileInfoMessageType("error");
    } finally {
      setProfileInfoSaving(false);
    }
  };

  const onOpenProfileImageEditor = () => {
    setProfileImageDraftData(profileImageData);
    setProfileImageDraftScale(profileImageScale);
    setProfileImageDraftOffsetX(profileImageOffsetX);
    setProfileImageDraftOffsetY(profileImageOffsetY);
    setProfileImageDragging(false);
    setProfileInfoMessage("");
    setShowEditProfileImageModal(true);
  };

  const onOpenProfileImageEditorFromSidebar = () => {
    setActive(isAdmin ? "profile" : "perfil");
    setUserMenuOpen(false);
    setNotificationPanelOpen(false);
    onOpenProfileImageEditor();
  };

  const onStartProfileImageDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !profileImageDraftData || profileImageDraftScale <= 1) {
      return;
    }
    const viewport = profileImageEditorViewportRef.current;
    if (!viewport) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startOffsetX = profileImageDraftOffsetX;
    const viewportWidth = viewport.clientWidth || 1;
    setProfileImageDragging(true);
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaPercent = ((moveEvent.clientX - startX) / viewportWidth) * 100;
      const nextOffset = clampProfileImageOffsetX(startOffsetX + deltaPercent, profileImageDraftScale);
      setProfileImageDraftOffsetX(nextOffset);
    };
    const handleMouseUp = () => {
      setProfileImageDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const onStartProfileImageTouchDrag = (event: TouchEvent<HTMLDivElement>) => {
    if (!profileImageDraftData || profileImageDraftScale <= 1) {
      return;
    }
    const viewport = profileImageEditorViewportRef.current;
    if (!viewport) {
      return;
    }
    const firstTouch = event.touches[0];
    if (!firstTouch) {
      return;
    }
    event.preventDefault();
    const startX = firstTouch.clientX;
    const startOffsetX = profileImageDraftOffsetX;
    const viewportWidth = viewport.clientWidth || 1;
    setProfileImageDragging(true);
    const handleTouchMove = (moveEvent: globalThis.TouchEvent) => {
      const touchPoint = moveEvent.touches[0];
      if (!touchPoint) {
        return;
      }
      moveEvent.preventDefault();
      const deltaPercent = ((touchPoint.clientX - startX) / viewportWidth) * 100;
      const nextOffset = clampProfileImageOffsetX(startOffsetX + deltaPercent, profileImageDraftScale);
      setProfileImageDraftOffsetX(nextOffset);
    };
    const handleTouchEnd = () => {
      setProfileImageDragging(false);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
  };

  const onProfileImageDraftFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }
    event.target.value = "";
    if (selectedFile.size > 5 * 1024 * 1024) {
      setProfileInfoMessage("La foto de perfil debe pesar maximo 5 MB.");
      setProfileInfoMessageType("error");
      return;
    }
    if (!selectedFile.type.startsWith("image/")) {
      setProfileInfoMessage("Selecciona un archivo de imagen valido.");
      setProfileInfoMessageType("error");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(selectedFile);
      setProfileImageDraftData(dataUrl);
      setProfileImageDraftScale(1);
      setProfileImageDraftOffsetX(0);
      setProfileImageDraftOffsetY(0);
      setProfileInfoMessage("Imagen cargada. Ajusta posicion y zoom.");
      setProfileInfoMessageType("success");
    } catch {
      setProfileInfoMessage("No se pudo leer la imagen seleccionada.");
      setProfileInfoMessageType("error");
    }
  };

  const onSaveProfileImageDraft = async () => {
    if (!user) {
      return;
    }
    if (!profileImageDraftData) {
      setProfileInfoMessage("Carga una imagen o usa Eliminar.");
      setProfileInfoMessageType("error");
      return;
    }
    const nextScale = Math.min(3, Math.max(1, profileImageDraftScale));
    const nextOffsetX = clampProfileImageOffsetX(profileImageDraftOffsetX, nextScale);
    const nextOffsetY = 0;
    setProfileImageSaving(true);
    try {
      const response = (await postJson("/api/v1/auth/profile-image", user.token, {
        profileImageData: profileImageDraftData,
        profileImageScale: nextScale,
        profileImageOffsetX: nextOffsetX,
        profileImageOffsetY: nextOffsetY,
      })) as ProfileImageSyncResponse;

      setProfileImageData(profileImageDraftData);
      setProfileImageScale(nextScale);
      setProfileImageOffsetX(nextOffsetX);
      setProfileImageOffsetY(nextOffsetY);
      const nextUser: SessionUser = {
        ...user,
        token: (response.token ?? user.token) as string,
        profileImageData: profileImageDraftData,
        profileImageScale: nextScale,
        profileImageOffsetX: nextOffsetX,
        profileImageOffsetY: nextOffsetY,
      };
      setUser(nextUser);
      localStorage.setItem("smartlearn_token", nextUser.token);
      localStorage.setItem("smartlearn_user", JSON.stringify(nextUser));
      localStorage.setItem(
        dashboardProfileImageKey(user.id),
        JSON.stringify({
          imageData: profileImageDraftData,
          scale: nextScale,
          offsetX: nextOffsetX,
          offsetY: nextOffsetY,
        }),
      );
      setShowEditProfileImageModal(false);
      setProfileInfoMessage("Foto de perfil actualizada.");
      setProfileInfoMessageType("success");
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message.trim() : "";
      const message =
        rawMessage.toLowerCase() === "recurso no encontrado"
          ? "Recurso no encontrado al guardar la foto. Revisa la configuracion de la URL de API (NEXT_PUBLIC_API_BASE_URL) y que exista /api/v1/auth/profile-image en el backend activo."
          : rawMessage || "No se pudo guardar la foto de perfil en el servidor.";
      setProfileInfoMessage(message);
      setProfileInfoMessageType("error");
    } finally {
      setProfileImageSaving(false);
    }
  };

  const onDeleteProfileImage = async () => {
    if (!user) {
      return;
    }
    try {
      const response = (await postJson("/api/v1/auth/profile-image", user.token, {
        profileImageData: null,
        profileImageScale: null,
        profileImageOffsetX: null,
        profileImageOffsetY: null,
      })) as ProfileImageSyncResponse;

      setProfileImageData(null);
      setProfileImageScale(1);
      setProfileImageOffsetX(0);
      setProfileImageOffsetY(0);
      setProfileImageDraftData(null);
      setProfileImageDraftScale(1);
      setProfileImageDraftOffsetX(0);
      setProfileImageDraftOffsetY(0);
      const nextUser: SessionUser = {
        ...user,
        token: (response.token ?? user.token) as string,
        profileImageData: null,
        profileImageScale: 1,
        profileImageOffsetX: 0,
        profileImageOffsetY: 0,
      };
      setUser(nextUser);
      localStorage.setItem("smartlearn_token", nextUser.token);
      localStorage.setItem("smartlearn_user", JSON.stringify(nextUser));
      localStorage.removeItem(dashboardProfileImageKey(user.id));
      setProfileInfoMessage("Foto de perfil eliminada.");
      setProfileInfoMessageType("success");
    } catch {
      setProfileInfoMessage("No se pudo eliminar la foto de perfil en el servidor.");
      setProfileInfoMessageType("error");
    }
  };

  const onSaveProfilePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (profileRequiresCurrentPassword && !profileCurrentPassword.trim()) {
      setProfilePasswordMessage("Ingresa tu password actual.");
      setProfilePasswordMessageType("error");
      return;
    }
    if (profileNewPassword.length < 3) {
      setProfilePasswordMessage("La nueva password debe tener minimo 3 caracteres.");
      setProfilePasswordMessageType("error");
      return;
    }
    if (profileNewPassword !== profileConfirmPassword) {
      setProfilePasswordMessage("La confirmacion de password no coincide.");
      setProfilePasswordMessageType("error");
      return;
    }

    setProfilePasswordSaving(true);
    try {
      await patchJson(`/api/v1/users/${user.id}/password?requesterUserId=${user.id}`, user.token, {
        currentPassword: profileRequiresCurrentPassword ? profileCurrentPassword : undefined,
        newPassword: profileNewPassword,
      });

      const nextUser: SessionUser = {
        ...user,
        hasLocalPassword: true,
      };
      setUser(nextUser);
      localStorage.setItem("smartlearn_user", JSON.stringify(nextUser));
      setProfileCurrentPassword("");
      setProfileNewPassword("");
      setProfileConfirmPassword("");
      setProfilePasswordMessage("Password actualizada.");
      setProfilePasswordMessageType("success");
    } catch (passwordError) {
      if (passwordError instanceof Error) {
        setProfilePasswordMessage(passwordError.message);
      } else {
        setProfilePasswordMessage("No se pudo actualizar la password.");
      }
      setProfilePasswordMessageType("error");
    } finally {
      setProfilePasswordSaving(false);
    }
  };

  const onDeleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deleteAccountPassword.trim()) {
      setDeleteAccountMessage("Ingresa tu password para confirmar.");
      setDeleteAccountMessageType("error");
      return;
    }

    setDeleteAccountSaving(true);
    try {
      setDeleteAccountMessage("Cuenta eliminada localmente. Cerrando sesion...");
      setDeleteAccountMessageType("success");
      setTimeout(() => {
        onLogout();
      }, 600);
    } catch {
      setDeleteAccountMessage("No se pudo eliminar la cuenta.");
      setDeleteAccountMessageType("error");
    } finally {
      setDeleteAccountSaving(false);
    }
  };

  const setIaFeedback = (message: string, type: "info" | "success" | "error") => {
    setIaStatus(message);
    setIaStatusType(type);
  };

  const loadIaModels = async () => {
    if (!user) {
      return;
    }

    setIaLoadingModels(true);
    try {
      const result = (await fetchJson(`/api/v1/ia/models?userId=${user.id}`, user.token)) as IaModelsResponse;
      const fromApi = Array.isArray(result.models)
        ? result.models
            .map((model) => (typeof model === "string" ? model.trim() : ""))
            .filter((model) => model.length > 0)
        : [];
      const defaultModel = typeof result.defaultModel === "string" ? result.defaultModel.trim() : "";
      const availableModels = fromApi.length > 0 ? fromApi : defaultModel ? [defaultModel] : [];

      setIaModels(availableModels);
      setIaSelectedModel((current) => {
        if (current && availableModels.includes(current)) {
          return current;
        }
        if (defaultModel && availableModels.includes(defaultModel)) {
          return defaultModel;
        }
        return availableModels[0] ?? "";
      });
    } catch {
      setIaModels([]);
      setIaSelectedModel("");
    } finally {
      setIaLoadingModels(false);
    }
  };

  const extractExamIdFromContent = (content: string): number | null => {
    const match = content.match(/EXAM_ID:\s*(\d+)/i);
    if (!match) {
      return null;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const buildExamNameFromFiles = (files: File[]): string => {
    const first = files[0]?.name ?? "";
    const base = first.replace(/\.[^/.]+$/, "").trim();
    return base || "examen_ia";
  };

  const refreshIaChats = async () => {
    if (!user) {
      return [] as ChatSummary[];
    }
    const chats = (await fetchJson(`/api/v1/ia/chats?userId=${user.id}`, user.token)) as ChatSummary[];
    setPayload(chats);
    return chats;
  };

  const loadIaChat = async (chatId: number) => {
    if (!user) {
      return;
    }
    setIaLoadingChat(true);
    try {
      setIaChatMenuOpenId(null);
      const detail = (await fetchJson(`/api/v1/ia/chats/${chatId}?userId=${user.id}`, user.token)) as ChatDetail;
      setIaIsNewChatMode(false);
      setIaSelectedChatId(chatId);
      setIaSelectedChat(detail);
      setIaExamFiles([]);
      setIaChatAttachments([]);
      setIaAttachmentInputKey((value) => value + 1);
    } catch (chatError) {
      if (chatError instanceof Error) {
        setIaFeedback(chatError.message, "error");
      } else {
        setIaFeedback("No se pudo abrir el chat.", "error");
      }
    } finally {
      setIaLoadingChat(false);
    }
  };

  const onCreateIaChat = () => {
    setIaIsNewChatMode(true);
    setIaChatMenuOpenId(null);
    setIaSelectedChatId(null);
    setIaSelectedChat(null);
    setIaDraftMessage("");
    setIaChatAttachments([]);
    setIaExamFiles([]);
    setIaExamName("");
    setIaExamInstructions("");
    setIaAttachmentInputKey((value) => value + 1);
    setIaFeedback("Nuevo chat listo. Escribe tu primer mensaje para crearlo.", "info");
  };

  const onShareIaChat = async (chat: ChatSummary) => {
    const shareText = `Chat IA: ${chat.name}`;
    const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/dashboard` : "";
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: chat.name,
          text: shareText,
          url: shareUrl,
        });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      }
      setIaFeedback("Chat listo para compartir.", "success");
    } catch {
      setIaFeedback("No se pudo compartir el chat.", "error");
    } finally {
      setIaChatMenuOpenId(null);
    }
  };

  const setShareFeedback = (
    resourceType: ShareResourceType,
    message: string,
    type: "info" | "success" | "error",
  ) => {
    if (resourceType === "exam") {
      setExamFeedback(message, type);
      return;
    }
    if (resourceType === "course") {
      setCourseFeedback(message, type);
      return;
    }
    if (resourceType === "schedule") {
      setScheduleFeedback(message, type);
      return;
    }
    setSalaFeedback(message, type);
  };

  const loadShareRecipients = useCallback(async (searchQuery: string) => {
    if (!user) {
      return;
    }
    const query = searchQuery.trim();
    if (query.length < 2) {
      shareRecipientsRequestVersionRef.current += 1;
      setShareRecipients([]);
      setShareRecipientsLoading(false);
      return;
    }

    const requestVersion = shareRecipientsRequestVersionRef.current + 1;
    shareRecipientsRequestVersionRef.current = requestVersion;
    setShareRecipientsLoading(true);
    try {
      const data = await fetchJson(
        `/api/v1/share-links/recipients?userId=${user.id}&query=${encodeURIComponent(query)}&limit=25`,
        user.token,
      );
      if (shareRecipientsRequestVersionRef.current !== requestVersion) {
        return;
      }
      const recipients = Array.isArray(data) ? data.filter((item) => isShareRecipientPayload(item)) : [];
      setShareRecipients(recipients);
    } catch {
      if (shareRecipientsRequestVersionRef.current !== requestVersion) {
        return;
      }
      setShareRecipients([]);
    } finally {
      if (shareRecipientsRequestVersionRef.current === requestVersion) {
        setShareRecipientsLoading(false);
      }
    }
  }, [user]);

  const onOpenShareModal = (resourceType: ShareResourceType, resourceId: number, resourceName: string) => {
    const resourceKey = `${resourceType}:${resourceId}`;
    setShareTarget({ resourceType, resourceId, resourceName });
    setPublicShareLink(publicShareLinksByResource[resourceKey] ?? "");
    shareRecipientsRequestVersionRef.current += 1;
    setShareRecipients([]);
    setShareRecipientsLoading(false);
    setShareRecipientSearch("");
    setShareSelectedRecipientIds([]);
    setShareExamRole("viewer");
    setShareExamCanShare(false);

    if (resourceType === "exam" && user) {
      setExamParticipantsLoading(true);
      fetchJson(`/api/v1/ia/exams/${resourceId}/participants?userId=${user.id}`, user.token)
        .then((data) => {
          const participants = Array.isArray(data) ? data.filter((item) => isExamParticipantPayload(item)) : [];
          setExamParticipants(participants);
        })
        .catch(() => {
          setExamParticipants([]);
        })
        .finally(() => {
          setExamParticipantsLoading(false);
        });
    } else {
      setExamParticipants([]);
    }
  };

  const closeShareModal = () => {
    if (creatingShareLink) {
      return;
    }
    setShareTarget(null);
    setPublicShareLink("");
    shareRecipientsRequestVersionRef.current += 1;
    setShareRecipients([]);
    setShareRecipientsLoading(false);
    setShareRecipientSearch("");
    setShareSelectedRecipientIds([]);
    setShareExamRole("viewer");
    setShareExamCanShare(false);
    setRemoveExamParticipantPrompt(null);
  };

  useEffect(() => {
    if (!shareTarget) {
      return;
    }

    const query = shareRecipientSearch.trim();
    if (query.length < 2) {
      shareRecipientsRequestVersionRef.current += 1;
      setShareRecipients([]);
      setShareRecipientsLoading(false);
      return;
    }

    const handle = window.setTimeout(() => {
      void loadShareRecipients(query);
    }, 280);

    return () => window.clearTimeout(handle);
  }, [shareTarget, shareRecipientSearch, loadShareRecipients]);

  const buildShareAccessUrl = (token: string): string => {
    if (typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/?share=${encodeURIComponent(token)}`;
  };

  const onGeneratePublicShareLink = async () => {
    if (!user || !shareTarget) {
      return;
    }
    setCreatingPublicShareLink(true);
    try {
      // Determinar endpoint por tipo de recurso.
      const endpoint = shareTarget.resourceType === "exam" 
        ? `/api/v1/share-links/exams/${shareTarget.resourceId}`
        : shareTarget.resourceType === "course"
          ? `/api/v1/share-links/courses/${shareTarget.resourceId}`
          : shareTarget.resourceType === "schedule"
            ? `/api/v1/share-links/schedules/${shareTarget.resourceId}`
            : shareTarget.resourceType === "sala"
              ? `/api/v1/share-links/salas/${shareTarget.resourceId}`
          : null;

      if (!endpoint) {
        setShareFeedback(shareTarget.resourceType, "Recurso no soportado para compartir enlace público.", "error");
        return;
      }

      const result = (await postJson(endpoint, user.token, {
        userId: user.id,
        expiresInHours: 720, // Por defecto, que dure un mes
      })) as { token: string };

      const generatedUrl = buildShareAccessUrl(result.token);
      const shareKey = `${shareTarget.resourceType}:${shareTarget.resourceId}`;
      setPublicShareLink(generatedUrl);
      setPublicShareLinksByResource((current) => ({
        ...current,
        [shareKey]: generatedUrl,
      }));
      setShareFeedback(shareTarget.resourceType, "Enlace publico listo para copiar.", "success");
    } catch (error) {
       if (error instanceof Error) {
         setShareFeedback(shareTarget.resourceType, error.message, "error");
       } else {
         setShareFeedback(shareTarget.resourceType, "Error al generar el enlace público.", "error");
       }
    } finally {
      setCreatingPublicShareLink(false);
    }
  };


  const onGenerateShareLink = async () => {
    if (!user || !shareTarget) {
      return;
    }

    const validSelectedIds = shareSelectedRecipientIds.filter(
      (id) => !examParticipants.some((p) => p.userId === id)
    );

    if (validSelectedIds.length === 0) {
      setShareFeedback(shareTarget.resourceType, "Selecciona al menos un usuario destino valido que no se encuentre ya en el recurso.", "error");
      return;
    }

    setCreatingShareLink(true);

    try {
      const result = (await postJson("/api/v1/share-links/distribute", user.token, {
        userId: user.id,
        resourceType: shareTarget.resourceType,
        resourceId: shareTarget.resourceId,
        resourceName: shareTarget.resourceName,
        recipientUserIds: validSelectedIds,
        examRole: shareTarget.resourceType === "exam" ? shareExamRole : undefined,
        examCanShare: shareTarget.resourceType === "exam" ? shareExamCanShare : undefined,
      })) as ShareDistributeResponse;

      if (shareTarget.resourceType === "exam") {
        const participantsData = await fetchJson(
          `/api/v1/ia/exams/${shareTarget.resourceId}/participants?userId=${user.id}`,
          user.token,
        );
        const participants = Array.isArray(participantsData)
          ? participantsData.filter((item) => isExamParticipantPayload(item))
          : [];
        setExamParticipants(participants);
      }

      setShareSelectedRecipientIds([]);
      setShareFeedback(
        shareTarget.resourceType,
        `Notificaciones de invitacion enviadas internamente a ${result.notificationsCreated ?? shareSelectedRecipientIds.length} usuario(s).`,
        "success",
      );
    } catch (shareError) {
      if (shareError instanceof Error) {
        setShareFeedback(shareTarget.resourceType, shareError.message, "error");
      } else {
        setShareFeedback(shareTarget.resourceType, "No se pudo generar el enlace para compartir.", "error");
      }
    } finally {
      setCreatingShareLink(false);
    }
  };

  const onCopyShareLink = async (urlToCopy: string) => {
    if (!urlToCopy.trim()) {
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(urlToCopy);
        setShareFeedback(shareTarget?.resourceType ?? "exam", "Enlace copiado al portapapeles.", "success");
      }
    } catch {
      setShareFeedback(shareTarget?.resourceType ?? "exam", "No se pudo copiar el enlace.", "error");
    }
  };

  const onOpenExamParticipantsModal = async (exam: ExamSummary) => {
    if (!user) {
      return;
    }
    setExamParticipantsTarget(exam);
    setExamParticipants([]);
    setShowExamParticipantsModal(true);
    setExamParticipantsLoading(true);
    setUpdatingExamParticipantUserId(null);
    try {
      const data = await fetchJson(`/api/v1/ia/exams/${exam.id}/participants?userId=${user.id}`, user.token);
      const participants = Array.isArray(data) ? data.filter((item) => isExamParticipantPayload(item)) : [];
      setExamParticipants(participants);
    } catch (participantsError) {
      if (participantsError instanceof Error) {
        setExamFeedback(participantsError.message, "error");
      } else {
        setExamFeedback("No se pudieron cargar los participantes del examen.", "error");
      }
      setShowExamParticipantsModal(false);
      setExamParticipantsTarget(null);
    } finally {
      setExamParticipantsLoading(false);
    }
  };

  const onUpdateExamParticipantPermissions = async (
    participant: ExamParticipant,
    nextRole: "viewer" | "editor",
    nextCanShare: boolean,
    nextCanStartGroup: boolean,
    nextCanRenameExam: boolean,
  ) => {
    if (!user || !examParticipantsTarget) {
      return;
    }
    if ((examParticipantsTarget.accessRole ?? "viewer").toLowerCase() !== "owner") {
      return;
    }
    setUpdatingExamParticipantUserId(participant.userId);
    try {
      await patchJson(
        `/api/v1/ia/exams/${examParticipantsTarget.id}/participants/${participant.userId}`,
        user.token,
        {
          requesterUserId: user.id,
          role: nextRole,
          canShare: nextCanShare,
          canStartGroup: nextCanStartGroup,
          canRenameExam: nextCanRenameExam,
        },
      );
      const refreshedParticipantsPayload = await fetchJson(
        `/api/v1/ia/exams/${examParticipantsTarget.id}/participants?userId=${user.id}`,
        user.token,
      );
      const refreshedParticipants = Array.isArray(refreshedParticipantsPayload)
        ? refreshedParticipantsPayload.filter((item) => isExamParticipantPayload(item))
        : [];
      setExamParticipants(refreshedParticipants);
      await refreshExams();
      setExamFeedback("Permisos del participante actualizados.", "success");
    } catch (updateError) {
      if (updateError instanceof Error) {
        setExamFeedback(updateError.message, "error");
      } else {
        setExamFeedback("No se pudieron actualizar los permisos del participante.", "error");
      }
    } finally {
      setUpdatingExamParticipantUserId(null);
    }
  };

  const onRemoveExamParticipant = async (examId: number, participant: ExamParticipant) => {
    if (!user) {
      return;
    }
    if (participant.owner || participant.role === "owner") {
      return;
    }
    setUpdatingExamParticipantUserId(participant.userId);
    try {
      await deleteJson(`/api/v1/ia/exams/${examId}/participants/${participant.userId}?requesterUserId=${user.id}`, user.token);
      setExamParticipants((current) => current.filter((item) => item.userId !== participant.userId));
      setShareSelectedRecipientIds((current) => current.filter((id) => id !== participant.userId));
      await refreshExams();
      setExamFeedback("Participante eliminado del examen.", "success");
    } catch (removeError) {
      if (removeError instanceof Error) {
        setExamFeedback(removeError.message, "error");
      } else {
        setExamFeedback("No se pudo eliminar al participante del examen.", "error");
      }
    } finally {
      setUpdatingExamParticipantUserId(null);
    }
  };

  const onRequestRemoveExamParticipant = (
    examId: number,
    participant: ExamParticipant,
    examName: string,
  ) => {
    if (participant.owner || participant.role === "owner") {
      return;
    }
    setRemoveExamParticipantPrompt({
      examId,
      examName: examName.trim() || "este examen",
      participant,
    });
  };

  const onCancelRemoveExamParticipant = () => {
    if (updatingExamParticipantUserId != null) {
      return;
    }
    setRemoveExamParticipantPrompt(null);
  };

  const onConfirmRemoveExamParticipant = async () => {
    if (!removeExamParticipantPrompt) {
      return;
    }
    const target = removeExamParticipantPrompt;
    await onRemoveExamParticipant(target.examId, target.participant);
    setRemoveExamParticipantPrompt(null);
  };

  const syncUpdatedNotification = (updated: ShareNotificationItem) => {
    setPayload((current: unknown) =>
      Array.isArray(current)
        ? current.map((item) =>
            isShareNotificationPayload(item) && item.id === updated.id ? { ...item, ...updated } : item,
          )
        : current,
    );
    setHomeShareNotifications((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
  };

  const onMarkNotificationAsRead = async (notification: ShareNotificationItem) => {
    if (!user || notificationActionLoadingId != null) {
      return;
    }
    setNotificationActionLoadingId(notification.id);
    try {
      const updated = (await patchJson(
        `/api/v1/share-links/notifications/${notification.id}/read?userId=${user.id}`,
        user.token,
        {},
      )) as ShareNotificationItem;
      syncUpdatedNotification(updated);
    } catch {
      setError("No se pudo marcar la notificacion como leida.");
    } finally {
      setNotificationActionLoadingId(null);
    }
  };

  const onMarkAllNotificationsAsRead = async () => {
    if (!user || markingAllNotifications || notificationActionLoadingId != null) {
      return;
    }
    const unreadNotifications = homeShareNotifications.filter((notification) => !notification.readAt);
    if (unreadNotifications.length === 0) {
      return;
    }

    setMarkingAllNotifications(true);
    try {
      await Promise.allSettled(
        unreadNotifications.map((notification) =>
          patchJson(`/api/v1/share-links/notifications/${notification.id}/read?userId=${user.id}`, user.token, {}),
        ),
      );
      await loadHomeShareNotifications();
      if (active === "notificaciones") {
        const notificationsPayload = await fetchJson(`/api/v1/share-links/notifications?userId=${user.id}`, user.token);
        setPayload(
          Array.isArray(notificationsPayload)
            ? notificationsPayload.filter((item) => isShareNotificationPayload(item))
            : [],
        );
      }
    } catch (markAllError) {
      if (markAllError instanceof Error) {
        setError(markAllError.message);
      } else {
        setError("No se pudieron marcar todas las notificaciones como leidas.");
      }
    } finally {
      setMarkingAllNotifications(false);
    }
  };

  const onAcceptNotificationInvitation = async (notification: ShareNotificationItem) => {
    if (!user || notificationActionLoadingId != null) {
      return;
    }
    if (normalizeInvitationStatus(notification.invitationStatus) !== "pending") {
      return;
    }
    setNotificationActionLoadingId(notification.id);
    try {
      const updated = (await patchJson(
        `/api/v1/share-links/notifications/${notification.id}/accept?userId=${user.id}`,
        user.token,
        {},
      )) as ShareNotificationItem;
      syncUpdatedNotification(updated);
      const resourceType = (updated.resourceType ?? notification.resourceType ?? "").trim().toLowerCase();
      if (resourceType === "exam") {
        const exams = (await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[];
        const examName = updated.resourceName?.trim() || notification.resourceName?.trim() || "Examen";
        setClaimedExamInvitePrompt({
          examId: updated.resourceId ?? notification.resourceId,
          examName,
          message: `Invitacion aceptada. ${examName} ya esta disponible en tu lista de examenes.`,
          cachedExams: exams,
        });
        setActive("inicio");
        return;
      }

      if (resourceType === "schedule") {
        const scheduleId = Number(updated.resourceId ?? notification.resourceId);
        if (Number.isFinite(scheduleId) && scheduleId > 0) {
          setSchedulePreferredProfileId(scheduleId);
          const scheduleModule = await fetchJson(`/api/v1/schedules?userId=${user.id}&scheduleId=${scheduleId}`, user.token);
          setPayload(scheduleModule);
          setActive("horarios");
          const scheduleName = updated.resourceName?.trim() || notification.resourceName?.trim() || "Horario";
          setScheduleFeedback(`Invitacion aceptada. ${scheduleName} ya esta disponible en tu modulo de horarios.`, "success");
        }
      }
    } catch (acceptError) {
      if (acceptError instanceof Error) {
        setError(acceptError.message);
      } else {
        setError("No se pudo aceptar la invitacion.");
      }
    } finally {
      setNotificationActionLoadingId(null);
    }
  };

  const onRejectNotificationInvitation = async (notification: ShareNotificationItem) => {
    if (!user || notificationActionLoadingId != null) {
      return;
    }
    if (normalizeInvitationStatus(notification.invitationStatus) !== "pending") {
      return;
    }
    setNotificationActionLoadingId(notification.id);
    try {
      const updated = (await patchJson(
        `/api/v1/share-links/notifications/${notification.id}/reject?userId=${user.id}`,
        user.token,
        {},
      )) as ShareNotificationItem;
      syncUpdatedNotification(updated);
    } catch (rejectError) {
      if (rejectError instanceof Error) {
        setError(rejectError.message);
      } else {
        setError("No se pudo rechazar la invitacion.");
      }
    } finally {
      setNotificationActionLoadingId(null);
    }
  };

  const onOpenNotificationResource = async (notification: ShareNotificationItem) => {
    if (!user) {
      return;
    }
    const resourceType = (notification.resourceType ?? "").trim().toLowerCase();
    const invitationStatus = normalizeInvitationStatus(notification.invitationStatus);
    if (notificationRequiresInvitationResponse(resourceType) && invitationStatus === "pending") {
      setError(
        resourceType === "exam"
          ? "Primero acepta o rechaza la invitacion del examen."
          : "Primero acepta o rechaza la invitacion del horario.",
      );
      return;
    }
    if (notificationRequiresInvitationResponse(resourceType) && invitationStatus === "rejected") {
      setError("Esta invitacion fue rechazada.");
      return;
    }

    if (resourceType === "exam") {
      try {
        const exams = (await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[];
        setPayload(exams);
        setActive("examenes");
        const examName = notification.resourceName?.trim() || "Examen";
        setExamFeedback(`${examName} disponible en tu lista de examenes.`, "success");
      } catch {
        setError("No se pudo abrir el examen invitado.");
      }
      return;
    }

    if (resourceType === "schedule") {
      if (notification.token && notification.token.trim()) {
        if (!notification.readAt) {
          await onMarkNotificationAsRead(notification);
        }
        router.push(`/dashboard?share=${encodeURIComponent(notification.token.trim())}`);
        return;
      }
      if (Number.isFinite(notification.resourceId) && notification.resourceId > 0) {
        try {
          if (!notification.readAt) {
            await onMarkNotificationAsRead(notification);
          }
          setSchedulePreferredProfileId(notification.resourceId);
          const scheduleModule = await fetchJson(
            `/api/v1/schedules?userId=${user.id}&scheduleId=${notification.resourceId}`,
            user.token,
          );
          setPayload(scheduleModule);
          setActive("horarios");
          setScheduleFeedback(
            notification.message?.trim() || "Horario compartido listo en tu modulo de horarios.",
            "success",
          );
          return;
        } catch {
          setError("No se pudo abrir el horario compartido.");
          return;
        }
      }
    }

    if (!notification.token || !notification.token.trim()) {
      setError("La notificacion no tiene un enlace valido.");
      return;
    }
    if (!notification.readAt) {
      await onMarkNotificationAsRead(notification);
    }
    router.push(`/dashboard?share=${encodeURIComponent(notification.token.trim())}`);
  };

  const onGoToClaimedExam = async () => {
    if (!user || !claimedExamInvitePrompt) {
      return;
    }
    const nextExams =
      claimedExamInvitePrompt.cachedExams.length > 0
        ? claimedExamInvitePrompt.cachedExams
        : ((await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[]);
    setPayload(nextExams);
    setActive("examenes");
    setExamFeedback(claimedExamInvitePrompt.message, "success");
    setClaimedExamInvitePrompt(null);
  };

  const onStayOnHomeAfterClaim = () => {
    setActive("inicio");
    setClaimedExamInvitePrompt(null);
    void loadHomeShareNotifications();
  };

  const onCreateSupportConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }
    const subject = supportSubject.trim();
    const initialMessage = supportInitialMessage.trim();
    if (!subject || !initialMessage) {
      setSupportFeedback("Completa asunto y mensaje inicial.", "error");
      return;
    }

    setSupportCreatingConversation(true);
    try {
      const created = (await postJson("/api/v1/support/conversations", user.token, {
        userId: user.id,
        subject,
        priority: supportPriority,
        channelPreference: supportChannel,
        whatsappNumber: supportWhatsappNumber.trim() || null,
        callNumber: supportCallNumber.trim() || null,
        initialMessage,
      })) as SupportConversationItem;

      setSupportSubject("");
      setSupportInitialMessage("");
      setSupportWhatsappNumber("");
      setSupportCallNumber("");
      setSupportFeedback("Caso de soporte creado.", "success");
      setSupportSelectedConversationId(created.id);
      await reloadSupportModule();
    } catch (supportError) {
      if (supportError instanceof Error) {
        setSupportFeedback(supportError.message, "error");
      } else {
        setSupportFeedback("No se pudo crear el caso de soporte.", "error");
      }
    } finally {
      setSupportCreatingConversation(false);
    }
  };

  const onSendSupportMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || supportSelectedConversationId == null) {
      return;
    }
    const message = supportDraftMessage.trim();
    if (!message) {
      return;
    }

    setSupportSendingMessage(true);
    try {
      const created = (await postJson(`/api/v1/support/conversations/${supportSelectedConversationId}/messages`, user.token, {
        userId: user.id,
        message,
      })) as SupportMessageItem;

      setSupportDraftMessage("");
      if (isSupportMessagePayload(created)) {
        setSupportMessages((current) => [...current, created]);
      }
      await reloadSupportModule();
    } catch (supportError) {
      if (supportError instanceof Error) {
        setSupportFeedback(supportError.message, "error");
      } else {
        setSupportFeedback("No se pudo enviar el mensaje de soporte.", "error");
      }
    } finally {
      setSupportSendingMessage(false);
    }
  };

  const onCreateSupportCallRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }
    const phoneNumber = supportCallPhone.trim();
    const reason = supportCallReason.trim();
    if (!phoneNumber || !reason) {
      setSupportFeedback("Completa telefono y motivo para solicitar llamada.", "error");
      return;
    }

    setSupportCreatingCallRequest(true);
    try {
      await postJson("/api/v1/support/call-requests", user.token, {
        userId: user.id,
        phoneNumber,
        preferredSchedule: supportCallSchedule.trim() || null,
        reason,
      });
      setSupportCallPhone("");
      setSupportCallSchedule("");
      setSupportCallReason("");
      setSupportFeedback("Solicitud de llamada registrada.", "success");
      await reloadSupportModule();
    } catch (supportError) {
      if (supportError instanceof Error) {
        setSupportFeedback(supportError.message, "error");
      } else {
        setSupportFeedback("No se pudo registrar la solicitud de llamada.", "error");
      }
    } finally {
      setSupportCreatingCallRequest(false);
    }
  };

  const onAssignSupportConversation = async (conversationId: number) => {
    if (!user) {
      return;
    }
    try {
      await postJson(`/api/v1/support/conversations/${conversationId}/assign?userId=${user.id}`, user.token, {});
      setSupportFeedback("Conversacion asignada.", "success");
      await reloadSupportModule();
    } catch (supportError) {
      if (supportError instanceof Error) {
        setSupportFeedback(supportError.message, "error");
      } else {
        setSupportFeedback("No se pudo asignar la conversacion.", "error");
      }
    }
  };

  const onCloseSupportConversation = async (conversationId: number) => {
    if (!user) {
      return;
    }
    try {
      await postJson(`/api/v1/support/conversations/${conversationId}/close?userId=${user.id}`, user.token, {});
      setSupportFeedback("Conversacion cerrada.", "success");
      await reloadSupportModule();
    } catch (supportError) {
      if (supportError instanceof Error) {
        setSupportFeedback(supportError.message, "error");
      } else {
        setSupportFeedback("No se pudo cerrar la conversacion.", "error");
      }
    }
  };

  const onOpenSupportWhatsApp = () => {
    if (typeof window === "undefined") {
      return;
    }
    const basePhone = "51999999999";
    const text = encodeURIComponent("Hola, necesito ayuda con SmartLearn.");
    window.open(`https://wa.me/${basePhone}?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const onArchiveIaChat = (chat: ChatSummary) => {
    setIaFeedback(`Chat '${chat.name}' archivado (simulado).`, "info");
    setIaChatMenuOpenId(null);
  };

  const onDeleteIaChat = (chat: ChatSummary) => {
    setIaFeedback(`Chat '${chat.name}' eliminado (simulado).`, "info");
    setIaChatMenuOpenId(null);
  };

  const onSendIaMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const trimmedMessage = iaDraftMessage.trim();
    if (!trimmedMessage && iaChatAttachments.length === 0) {
      return;
    }

    if (iaChatAttachments.length > 3) {
      setIaFeedback("Solo se permiten hasta 3 archivos adjuntos.", "error");
      return;
    }

    const hasInvalidAttachment = iaChatAttachments.some((file) => {
      const name = file.name.toLowerCase();
      return !(name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx"));
    });
    if (hasInvalidAttachment) {
      setIaFeedback("Solo se permiten archivos PDF o Word (.doc, .docx).", "error");
      return;
    }

    const attachmentName =
      iaChatAttachments.length > 0 ? iaChatAttachments.map((file) => file.name).join(", ") : undefined;
    const contentToSend = trimmedMessage || "Te envio material para generar un examen.";

    setIaSendingMessage(true);
    try {
      let detail: ChatDetail;
      if (iaSelectedChatId == null) {
        detail = (await postJson("/api/v1/ia/chats", user.token, {
          userId: user.id,
          firstMessage: contentToSend,
          attachmentName,
        })) as ChatDetail;
        setIaSelectedChatId(detail.id);
        setIaIsNewChatMode(false);
      } else {
        detail = (await postJson(`/api/v1/ia/chats/${iaSelectedChatId}/messages`, user.token, {
          userId: user.id,
          content: contentToSend,
          attachmentName,
        })) as ChatDetail;
      }
      setIaDraftMessage("");
      setIaSelectedChat(detail);
      await refreshIaChats();

      if (iaChatAttachments.length > 0) {
        const nextExamName = iaExamName.trim() ? iaExamName.trim() : buildExamNameFromFiles(iaChatAttachments);
        setIaExamFiles(iaChatAttachments);
        setIaExamName(nextExamName);
        setIaExamQuestionsCount("20");
        setIaFeedback(
          "Recibi tus archivos. Ahora define nombre y cuantas preguntas deseas, luego pulsa Generar examen.",
          "info",
        );
      }

      setIaChatAttachments([]);
      setIaAttachmentInputKey((value) => value + 1);
    } catch (sendError) {
      if (sendError instanceof Error) {
        setIaFeedback(sendError.message, "error");
      } else {
        setIaFeedback("No se pudo enviar el mensaje.", "error");
      }
    } finally {
      setIaSendingMessage(false);
    }
  };

  const onGenerateExamFromIa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || iaSelectedChatId == null) {
      return;
    }

    if (iaExamFiles.length === 0) {
      setIaFeedback("Primero adjunta al menos 1 archivo desde el chat.", "error");
      return;
    }
    if (iaExamFiles.length > 3) {
      setIaFeedback("Solo se permiten hasta 3 PDF.", "error");
      return;
    }

    const hasInvalidFile = iaExamFiles.some((file) => {
      const name = file.name.toLowerCase();
      return !(name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx"));
    });
    if (hasInvalidFile) {
      setIaFeedback("Solo se permiten archivos PDF o Word (.doc, .docx).", "error");
      return;
    }

    const parsedQuestions = Number.parseInt(iaExamQuestionsCount, 10);
    const safeQuestions = Number.isNaN(parsedQuestions) ? 20 : Math.max(10, Math.min(100, parsedQuestions));

    const formData = new FormData();
    formData.append("userId", String(user.id));
    formData.append("questionsCount", String(safeQuestions));
    if (iaExamName.trim()) {
      formData.append("examName", iaExamName.trim());
    }
    if (iaExamInstructions.trim()) {
      formData.append("instructions", iaExamInstructions.trim());
    }
    if (iaSelectedModel.trim()) {
      formData.append("model", iaSelectedModel.trim());
    }
    iaExamFiles.forEach((file) => formData.append("files", file));

    setIaGeneratingExam(true);
    try {
      const result = (await postFormData(
        `/api/v1/ia/chats/${iaSelectedChatId}/generate-exam`,
        user.token,
        formData,
      )) as ChatGenerateExamResult;

      setIaSelectedChat(result.chat);
      setIaExamFiles([]);
      setIaExamName("");
      setIaExamInstructions("");
      setIaFeedback(
        `Examen generado: ${result.examName} (${result.questionsCount} preguntas). Ya esta guardado en Examenes.`,
        "success",
      );
      await refreshIaChats();
    } catch (generateError) {
      if (generateError instanceof Error) {
        setIaFeedback(generateError.message, "error");
      } else {
        setIaFeedback("No se pudo generar el examen con IA.", "error");
      }
    } finally {
      setIaGeneratingExam(false);
    }
  };

  useEffect(() => {
    if (active !== "ia" || !user) {
      return;
    }
    void loadIaModels();
  }, [active, user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (iaSelectedChatId == null) {
      return;
    }
    window.localStorage.setItem(dashboardIaChatKey(user.id), String(iaSelectedChatId));
  }, [iaSelectedChatId, user]);

  useEffect(() => {
    if (active !== "ia" || !user) {
      return;
    }
    if (iaIsNewChatMode) {
      return;
    }

    if (!isIaChatSummaryArrayPayload(payload)) {
      return;
    }
    const data = payload;
    if (data.length === 0) {
      if (iaSelectedChatId != null) {
        setIaSelectedChatId(null);
        setIaSelectedChat(null);
      }
      window.localStorage.removeItem(dashboardIaChatKey(user.id));
      return;
    }

    if (iaSelectedChatId == null) {
      const rawStoredChatId = window.localStorage.getItem(dashboardIaChatKey(user.id));
      if (rawStoredChatId) {
        const storedChatId = Number(rawStoredChatId);
        const storedExists = Number.isFinite(storedChatId) && data.some((chat) => chat.id === storedChatId);
        if (storedExists) {
          void loadIaChat(storedChatId);
          return;
        }
        window.localStorage.removeItem(dashboardIaChatKey(user.id));
      }
    }

    const selectedExists =
      iaSelectedChatId != null && data.some((chat) => chat.id === iaSelectedChatId);
    if (!selectedExists) {
      void loadIaChat(data[0].id);
    }
  }, [active, iaIsNewChatMode, iaSelectedChatId, payload, user]);

  const loadRoleManagement = async (preferredRoleId?: number) => {
    if (!user) {
      return;
    }

    setRolesLoading(true);
    try {
      const data = (await fetchJson(
        `/api/v1/roles/management?requesterUserId=${user.id}`,
        user.token,
      )) as RoleManagementPayload;

      const nextRoles = Array.isArray(data.roles) ? data.roles : [];
      const nextPermissions = Array.isArray(data.availablePermissions) ? data.availablePermissions : [];
      setRolesData(nextRoles);
      setAvailablePermissions(nextPermissions);

      if (nextRoles.length === 0) {
        setSelectedRoleId(null);
        setSelectedRolePermissions([]);
        return;
      }

      const targetId = preferredRoleId ?? selectedRoleId;
      const selected = nextRoles.find((role) => role.id === targetId) ?? nextRoles[0];
      setSelectedRoleId(selected.id);
      setSelectedRolePermissions(selected.permissions ?? []);
    } catch (rolesError) {
      if (rolesError instanceof Error) {
        setUserFeedback(rolesError.message, "error");
      } else {
        setUserFeedback("No se pudo cargar la gestion de roles.", "error");
      }
    } finally {
      setRolesLoading(false);
    }
  };

  const onOpenManageRoles = () => {
    setShowManageRolesPanel(true);
    void loadRoleManagement();
  };

  const onCreateRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    if (!newRoleName.trim()) {
      setUserFeedback("Ingresa un nombre de rol.", "error");
      return;
    }

    setCreatingRole(true);
    try {
      const created = (await postJson(`/api/v1/roles?requesterUserId=${user.id}`, user.token, {
        roleName: newRoleName.trim(),
      })) as AdminRoleRow;

      setNewRoleName("");
      await loadRoleManagement(created.id);
      setUserFeedback("Rol creado correctamente.", "success");
    } catch (createRoleError) {
      if (createRoleError instanceof Error) {
        setUserFeedback(createRoleError.message, "error");
      } else {
        setUserFeedback("No se pudo crear el rol.", "error");
      }
    } finally {
      setCreatingRole(false);
    }
  };

  const onSelectRole = (roleId: number) => {
    setSelectedRoleId(roleId);
    const role = rolesData.find((item) => item.id === roleId);
    setSelectedRolePermissions(role?.permissions ?? []);
  };

  const onToggleRolePermission = (permissionName: string) => {
    setSelectedRolePermissions((current) =>
      current.includes(permissionName)
        ? current.filter((item) => item !== permissionName)
        : [...current, permissionName],
    );
  };

  const onSaveRolePermissions = async () => {
    if (!user || selectedRoleId == null) {
      return;
    }

    if (selectedRolePermissions.length === 0) {
      setUserFeedback("Selecciona al menos un permiso para el rol.", "error");
      return;
    }

    setRolesSaving(true);
    try {
      await patchJson(`/api/v1/roles/${selectedRoleId}/permissions?requesterUserId=${user.id}`, user.token, {
        permissions: selectedRolePermissions,
      });
      await loadRoleManagement(selectedRoleId);
      setUserFeedback("Permisos del rol actualizados.", "success");
    } catch (saveError) {
      if (saveError instanceof Error) {
        setUserFeedback(saveError.message, "error");
      } else {
        setUserFeedback("No se pudieron guardar los permisos.", "error");
      }
    } finally {
      setRolesSaving(false);
    }
  };

  const refreshExams = async (): Promise<ExamSummary[]> => {
    if (!user) {
      return [];
    }
    const exams = (await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[];
    setPayload(exams);
    return exams;
  };

  useEffect(() => {
    if (!user || !showGroupPracticeRunnerModal || !selectedExam || !groupPracticeState) {
      return;
    }
    const status = (groupPracticeState.status ?? "").toLowerCase();
    if (status !== "waiting" && status !== "active") {
      return;
    }

    window.localStorage.setItem(
      dashboardGroupPracticeViewKey(user.id),
      JSON.stringify({
        examId: selectedExam.id,
        sessionId: groupPracticeState.sessionId,
        originSection: practiceOriginSection,
      }),
    );
  }, [user, showGroupPracticeRunnerModal, selectedExam, groupPracticeState, practiceOriginSection]);

  useEffect(() => {
    if (!user || active !== "examenes" || showGroupPracticeRunnerModal) {
      return;
    }
    if (groupPracticeRestoreTriedRef.current) {
      return;
    }

    const rawStored = window.localStorage.getItem(dashboardGroupPracticeViewKey(user.id));
    groupPracticeRestoreTriedRef.current = true;
    if (!rawStored) {
      return;
    }

    const removeStored = () => {
      window.localStorage.removeItem(dashboardGroupPracticeViewKey(user.id));
    };

    let parsed: { examId?: unknown; sessionId?: unknown; originSection?: unknown };
    try {
      parsed = JSON.parse(rawStored) as { examId?: unknown; sessionId?: unknown; originSection?: unknown };
    } catch {
      removeStored();
      return;
    }

    const examId = Number(parsed.examId);
    const sessionId = Number(parsed.sessionId);
    if (!Number.isFinite(examId) || examId <= 0 || !Number.isFinite(sessionId) || sessionId <= 0) {
      removeStored();
      return;
    }

    const originSection =
      parsed.originSection === "ia" || parsed.originSection === "cursos" || parsed.originSection === "examenes"
        ? parsed.originSection
        : "examenes";

    void (async () => {
      try {
        const exams = await refreshExams();
        const targetExam = exams.find((item) => item.id === examId);
        if (!targetExam) {
          removeStored();
          return;
        }

        const state = (await fetchJson(
          `/api/v1/ia/exams/${targetExam.id}/practice/group/state?userId=${user.id}&sessionId=${sessionId}&ts=${Date.now()}`,
          user.token,
        )) as ExamGroupState;
        const status = (state.status ?? "").toLowerCase();
        if (status === "finished") {
          removeStored();
          return;
        }

        setPracticeOriginSection(originSection);
        setSelectedExam(targetExam);
        setGroupPracticeState(state);
        setShowGroupPracticeRunnerModal(true);
      } catch {
        removeStored();
      }
    })();
  }, [user, active, showGroupPracticeRunnerModal]);

  useEffect(() => {
    if (!user || active !== "examenes" || showPracticeRunnerModal || showGroupPracticeRunnerModal) {
      return;
    }

    const refreshHandle = window.setInterval(() => {
      void (async () => {
        try {
          const exams = (await fetchJson(`/api/v1/ia/exams?userId=${user.id}`, user.token)) as ExamSummary[];
          setPayload(exams);
        } catch {
          // silencio para polling
        }
      })();
    }, 8000);

    return () => window.clearInterval(refreshHandle);
  }, [user, active, showPracticeRunnerModal, showGroupPracticeRunnerModal]);

  const onStartPracticeFromIa = async (examId: number) => {
    if (!user) {
      return;
    }

    setPracticeOriginSection("ia");
    setActive("examenes");
    setPracticeIntent("start");

    try {
      const exams = await refreshExams();
      const targetExam = exams.find((item) => item.id === examId);
      if (!targetExam) {
        setExamFeedback("No se encontro el examen generado en tu lista.", "error");
        return;
      }
      if ((targetExam.participantsCount ?? 1) <= 1) {
        await onStartPractice(targetExam, false);
        return;
      }
      setSelectedExam(targetExam);
      setPracticeStartMode("personal");
      setShowPracticeModal(true);
    } catch (startError) {
      if (startError instanceof Error) {
        setExamFeedback(startError.message, "error");
      } else {
        setExamFeedback("No se pudo abrir el repaso desde IA.", "error");
      }
    }
  };

  const replaceExamInPayload = (updatedExam: ExamSummary) => {
    if (Array.isArray(payload)) {
      const next = (payload as ExamSummary[]).map((item) => (item.id === updatedExam.id ? updatedExam : item));
      setPayload(next);
    }
  };

  const openManageExamModal = (exam: ExamSummary, questions: ExamQuestion[]) => {
    setSelectedExam(exam);
    setManagedExamQuestions(questions);
    setEditingQuestionId(null);
    setManualQuestionForm(createEmptyManualQuestionForm());
    setShowManageModal(true);
  };

  const onRenameExamName = (exam: ExamSummary) => {
    setRenameExamTarget(exam);
    setRenameExamNameDraft((exam.name ?? "").trim());
    setShowRenameExamModal(true);
  };

  const onSaveRenameExamName = async () => {
    if (!user || !renameExamTarget) {
      return;
    }

    const currentName = (renameExamTarget.name ?? "").trim();
    const nextName = renameExamNameDraft.trim();

    if (!nextName) {
      setExamFeedback("El nombre del examen no puede estar vacio.", "error");
      return;
    }

    if (nextName === currentName) {
      setShowRenameExamModal(false);
      setRenameExamTarget(null);
      return;
    }

    setRenamingExam(true);
    try {
      const updatedExam = (await patchJson(`/api/v1/ia/exams/${renameExamTarget.id}/name`, user.token, {
        userId: user.id,
        examName: nextName,
      })) as ExamSummary;
      replaceExamInPayload(updatedExam);
      if (selectedExam && selectedExam.id === renameExamTarget.id) {
        setSelectedExam(updatedExam);
      }
      if (examParticipantsTarget && examParticipantsTarget.id === renameExamTarget.id) {
        setExamParticipantsTarget(updatedExam);
      }
      setExamFeedback("Nombre del examen actualizado.", "success");
      setShowRenameExamModal(false);
      setRenameExamTarget(null);
    } catch (renameError) {
      if (renameError instanceof Error) {
        setExamFeedback(renameError.message, "error");
      } else {
        setExamFeedback("No se pudo actualizar el nombre del examen.", "error");
      }
    } finally {
      setRenamingExam(false);
    }
  };

  const questionTypeLabel = (questionType: string) =>
    questionType === "multiple_choice" ? "Seleccion" : "Escrita";

  const formatExamCreatedAt = (camelCaseValue?: unknown, snakeCaseValue?: unknown) => {
    const value = camelCaseValue ?? snakeCaseValue ?? null;
    if (!value) {
      return "N/D";
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(value);
    }

    if (Array.isArray(value) && value.length >= 5) {
      const parts = value.map((item) => Number(item));
      if (parts.every((item) => Number.isFinite(item))) {
        const [year, month, day, hour, minute, second = 0] = parts;
        const fromArray = new Date(year, month - 1, day, hour, minute, second);
        if (!Number.isNaN(fromArray.getTime())) {
          return new Intl.DateTimeFormat("es-PE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(fromArray);
        }
      }
    }

    if (typeof value !== "string") {
      if (typeof value === "object" && value !== null) {
        const maybeDate = value as {
          year?: unknown;
          month?: unknown;
          monthValue?: unknown;
          day?: unknown;
          dayOfMonth?: unknown;
          hour?: unknown;
          minute?: unknown;
          second?: unknown;
        };

        const year = Number(maybeDate.year);
        const month = Number(maybeDate.monthValue ?? maybeDate.month);
        const day = Number(maybeDate.dayOfMonth ?? maybeDate.day);
        const hour = Number(maybeDate.hour ?? 0);
        const minute = Number(maybeDate.minute ?? 0);
        const second = Number(maybeDate.second ?? 0);

        if (
          Number.isFinite(year) &&
          Number.isFinite(month) &&
          Number.isFinite(day) &&
          Number.isFinite(hour) &&
          Number.isFinite(minute) &&
          Number.isFinite(second)
        ) {
          const fromObject = new Date(year, month - 1, day, hour, minute, second);
          if (!Number.isNaN(fromObject.getTime())) {
            return new Intl.DateTimeFormat("es-PE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(fromObject);
          }
        }
      }
      return "N/D";
    }

    let date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/,
      );
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6] ?? "0");
        date = new Date(year, month, day, hour, minute, second);
      }
      if (Number.isNaN(date.getTime())) {
        return "N/D";
      }
    }

    return new Intl.DateTimeFormat("es-PE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const onCreateManualExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || !manualExamName.trim()) {
      return;
    }

    setCreatingManualExam(true);
    setExamMessage("");

    try {
      const created = (await postJson("/api/v1/ia/exams/manual", user.token, {
        userId: user.id,
        manualExamName: manualExamName.trim(),
      })) as ExamSummary;

      const current = Array.isArray(payload) ? (payload as ExamSummary[]) : [];
      setPayload([created, ...current]);
      setManualExamName("");
      setExamFeedback("Examen manual creado correctamente.", "success");
    } catch (createError) {
      if (createError instanceof Error) {
        setExamFeedback(createError.message, "error");
      } else {
        setExamFeedback("No se pudo crear el examen manual.", "error");
      }
    } finally {
      setCreatingManualExam(false);
    }
  };

  const onUploadExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !uploadExamName.trim() || !uploadExamFile) {
      setExamFeedback("Debes ingresar nombre y seleccionar un archivo Excel.", "error");
      return;
    }

    setUploadingExam(true);
    try {
      const formData = new FormData();
      formData.append("userId", String(user.id));
      formData.append("examName", uploadExamName.trim());
      formData.append("examFile", uploadExamFile);

      await postFormData("/api/v1/ia/exams", user.token, formData);
      await refreshExams();

      setUploadExamName("");
      setUploadExamFile(null);
      setShowUploadModal(false);
      setExamSearch("");
      setExamFeedback("Examen importado correctamente desde Excel.", "success");
    } catch (uploadError) {
      if (uploadError instanceof Error) {
        setExamFeedback(uploadError.message, "error");
      } else {
        setExamFeedback("No se pudo importar el archivo Excel.", "error");
      }
    } finally {
      setUploadingExam(false);
    }
  };

  const onDownloadExamFormat = async () => {
    if (!user) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/ia/exams/format/v2?ts=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });

      if (!response.ok) {
        let message = "No se pudo descargar el formato";
        try {
          const body = (await response.json()) as { error?: string; message?: string };
          message = body.error || body.message || message;
        } catch {
          // ignore parse error
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "formato_examen_a21k_v2.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setExamFeedback("Formato descargado correctamente.", "success");
    } catch (downloadError) {
      if (downloadError instanceof Error) {
        setExamFeedback(downloadError.message, "error");
      } else {
        setExamFeedback("No se pudo descargar el formato.", "error");
      }
    }
  };

  const onManageExamQuestions = async (exam: ExamSummary) => {
    if (!user) {
      return;
    }

    try {
      const questions = (await fetchJson(
        `/api/v1/ia/exams/${exam.id}/manual?userId=${user.id}`,
        user.token,
      )) as ExamQuestion[];
      openManageExamModal(exam, questions);
      setExamFeedback(`Examen '${exam.name}': ${questions.length} preguntas cargadas.`, "info");
    } catch (manageError) {
      if (manageError instanceof Error) {
        setExamFeedback(manageError.message, "error");
      } else {
        setExamFeedback("No se pudo cargar las preguntas del examen.", "error");
      }
    }
  };

  const onInactivateExam = async (exam: ExamSummary) => {
    if (!user) {
      return;
    }

    try {
      await deleteJson(`/api/v1/ia/exams/${exam.id}?userId=${user.id}`, user.token);
      await refreshExams();
      if (selectedExam?.id === exam.id) {
        setSelectedExam(null);
        setManagedExamQuestions([]);
      }
      setShowDeactivateModal(false);
      clearPracticeDraft(exam.id);
      setExamFeedback(`Examen '${exam.name}' inactivado correctamente.`, "success");
    } catch (deleteError) {
      if (deleteError instanceof Error) {
        setExamFeedback(deleteError.message, "error");
      } else {
        setExamFeedback("No se pudo inactivar el examen.", "error");
      }
    }
  };

  const onResetPractice = (exam: ExamSummary) => {
    clearPracticeDraft(exam.id);
    if (selectedExam?.id === exam.id) {
      setSelectedExam(null);
      setShowPracticeRunnerModal(false);
      setPracticeQuestions([]);
      setPracticeResults({});
      setPracticeFinished(false);
      setPracticeIndex(0);
      setPracticeIntent("start");
      resetPracticeInputState();
    }
    setExamFeedback("Repaso reiniciado. Ahora puedes iniciar desde 0.", "success");
  };

  const onEditManualQuestion = (question: ExamQuestion) => {
    setEditingQuestionId(question.id);
    setManualQuestionForm({
      questionText: question.questionText ?? "",
      questionType: (question.questionType === "written" ? "written" : "multiple_choice") as
        | "multiple_choice"
        | "written",
      correctAnswer: question.correctAnswer ?? "",
      explanation: question.explanation ?? "",
      points: String(question.points ?? 1),
      temporizadorSegundos: String(question.temporizadorSegundos ?? 30),
      reviewSeconds: String(question.reviewSeconds ?? 10),
      timerEnabled: question.timerEnabled ?? true,
      optionA: question.optionA ?? "",
      optionB: question.optionB ?? "",
      optionC: question.optionC ?? "",
      optionD: question.optionD ?? "",
      correctOption: (question.correctOption === "b" || question.correctOption === "c" || question.correctOption === "d"
        ? question.correctOption
        : "a") as "a" | "b" | "c" | "d",
    });
  };

  const onCancelManualQuestionEdit = () => {
    setEditingQuestionId(null);
    setManualQuestionForm(createEmptyManualQuestionForm());
  };

  const onSaveManualQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || !selectedExam) {
      return;
    }

    const points = Number.parseInt(manualQuestionForm.points, 10);
    const temporizadorSegundos = Number.parseInt(manualQuestionForm.temporizadorSegundos, 10);
    const reviewSeconds = Number.parseInt(manualQuestionForm.reviewSeconds, 10);

    if (!manualQuestionForm.questionText.trim()) {
      setExamFeedback("La pregunta es obligatoria.", "error");
      return;
    }
    if (!Number.isFinite(points) || points <= 0) {
      setExamFeedback("Puntaje debe ser mayor a 0.", "error");
      return;
    }
    if (!Number.isFinite(temporizadorSegundos) || temporizadorSegundos <= 0) {
      setExamFeedback("Temporizador debe ser mayor a 0.", "error");
      return;
    }
    if (!Number.isFinite(reviewSeconds) || reviewSeconds <= 0) {
      setExamFeedback("Tiempo de revision debe ser mayor a 0.", "error");
      return;
    }

    setSavingManualQuestion(true);

    try {
      const body = {
        userId: user.id,
        questionText: manualQuestionForm.questionText.trim(),
        questionType: manualQuestionForm.questionType,
        correctAnswer:
          manualQuestionForm.questionType === "written" ? manualQuestionForm.correctAnswer.trim() : null,
        explanation: manualQuestionForm.explanation.trim() || null,
        points,
        temporizadorSegundos,
        reviewSeconds,
        timerEnabled: manualQuestionForm.timerEnabled,
        optionA: manualQuestionForm.questionType === "multiple_choice" ? manualQuestionForm.optionA.trim() : null,
        optionB: manualQuestionForm.questionType === "multiple_choice" ? manualQuestionForm.optionB.trim() : null,
        optionC: manualQuestionForm.questionType === "multiple_choice" ? manualQuestionForm.optionC.trim() : null,
        optionD: manualQuestionForm.questionType === "multiple_choice" ? manualQuestionForm.optionD.trim() : null,
        correctOption: manualQuestionForm.questionType === "multiple_choice" ? manualQuestionForm.correctOption : null,
      };

      let savedQuestion: ExamQuestion;
      if (editingQuestionId != null) {
        savedQuestion = (await patchJson(
          `/api/v1/ia/exams/${selectedExam.id}/manual/questions/${editingQuestionId}`,
          user.token,
          body,
        )) as ExamQuestion;
      } else {
        savedQuestion = (await postJson(
          `/api/v1/ia/exams/${selectedExam.id}/manual/questions`,
          user.token,
          body,
        )) as ExamQuestion;
      }

      const refreshedQuestions = (await fetchJson(
        `/api/v1/ia/exams/${selectedExam.id}/manual?userId=${user.id}`,
        user.token,
      )) as ExamQuestion[];

      setManagedExamQuestions(refreshedQuestions);
      onCancelManualQuestionEdit();

      const updatedExam: ExamSummary = {
        ...selectedExam,
        questionsCount: refreshedQuestions.length,
      };
      setSelectedExam(updatedExam);
      replaceExamInPayload(updatedExam);

      setExamFeedback(
        editingQuestionId != null
          ? `Pregunta #${savedQuestion.id} actualizada correctamente.`
          : `Pregunta #${savedQuestion.id} creada correctamente.`,
        "success",
      );
    } catch (saveError) {
      if (saveError instanceof Error) {
        setExamFeedback(saveError.message, "error");
      } else {
        setExamFeedback("No se pudo guardar la pregunta.", "error");
      }
    } finally {
      setSavingManualQuestion(false);
    }
  };

  const resolvePracticeSettingsFromExam = (exam: ExamSummary): PracticeSettingsPayload => ({
    practiceFeedbackMode: exam.practiceFeedbackEnabled === false ? "without_feedback" : "with_feedback",
    practiceOrderMode: exam.practiceOrderMode === "random" ? "random" : "ordered",
    practiceProgressMode: exam.practiceRepeatUntilCorrect === false ? "allow_incorrect_pass" : "repeat_until_correct",
  });

  const loadIndividualPracticeSettings = async (exam: ExamSummary, forceReload = false): Promise<PracticeSettingsPayload> => {
    if (!user) {
      return resolvePracticeSettingsFromExam(exam);
    }

    const cached = individualPracticeSettingsByExamId[exam.id];
    if (cached && !forceReload) {
      return cached;
    }

    try {
      const response = (await fetchJson(
        `/api/v1/ia/exams/${exam.id}/practice/settings/individual?userId=${user.id}`,
        user.token,
      )) as PracticeSettingsPayload;
      const normalized: PracticeSettingsPayload = {
        practiceFeedbackMode: response.practiceFeedbackMode === "without_feedback" ? "without_feedback" : "with_feedback",
        practiceOrderMode: response.practiceOrderMode === "random" ? "random" : "ordered",
        practiceProgressMode:
          response.practiceProgressMode === "allow_incorrect_pass" ? "allow_incorrect_pass" : "repeat_until_correct",
      };
      setIndividualPracticeSettingsByExamId((previous) => ({ ...previous, [exam.id]: normalized }));
      return normalized;
    } catch {
      return resolvePracticeSettingsFromExam(exam);
    }
  };

  const openGroupPracticeSettingsModal = (exam: ExamSummary) => {
    setSelectedExam(exam);
    const defaults = resolvePracticeSettingsFromExam(exam);
    setPracticeFeedbackMode(defaults.practiceFeedbackMode);
    setPracticeOrderMode(defaults.practiceOrderMode);
    setPracticeProgressMode(defaults.practiceProgressMode);
    setPracticeExamVisibility(exam.visibility === "public" ? "public" : "private");
    setShowGroupSettingsModal(true);
  };

  const openIndividualPracticeSettingsModal = async (exam: ExamSummary) => {
    setSelectedExam(exam);
    const settings = await loadIndividualPracticeSettings(exam, true);
    setPracticeFeedbackMode(settings.practiceFeedbackMode);
    setPracticeOrderMode(settings.practiceOrderMode);
    setPracticeProgressMode(settings.practiceProgressMode);
    setShowIndividualSettingsModal(true);
  };

  const onSaveGroupPracticeSettings = async () => {
    if (!user || !selectedExam) {
      return;
    }

    setSavingPracticeSettings(true);
    try {
      const updated = (await patchJson(
        `/api/v1/ia/exams/${selectedExam.id}/practice/settings`,
        user.token,
        {
          userId: user.id,
          practiceFeedbackMode,
          practiceOrderMode,
          practiceProgressMode,
          visibility: practiceExamVisibility,
        },
      )) as ExamSummary;

      if (Array.isArray(payload)) {
        const next = (payload as ExamSummary[]).map((item) => (item.id === updated.id ? updated : item));
        setPayload(next);
      }

      setSelectedExam(updated);
      setShowGroupSettingsModal(false);
      setExamFeedback("Configuracion de repaso grupal guardada.", "success");
    } catch (saveError) {
      if (saveError instanceof Error) {
        setExamFeedback(saveError.message, "error");
      } else {
        setExamFeedback("No se pudo guardar la configuracion.", "error");
      }
    } finally {
      setSavingPracticeSettings(false);
    }
  };

  const onSaveIndividualPracticeSettings = async () => {
    if (!user || !selectedExam) {
      return;
    }

    setSavingPracticeSettings(true);
    try {
      const updated = (await patchJson(
        `/api/v1/ia/exams/${selectedExam.id}/practice/settings/individual`,
        user.token,
        {
          userId: user.id,
          practiceFeedbackMode,
          practiceOrderMode,
          practiceProgressMode,
        },
      )) as PracticeSettingsPayload;

      const normalized: PracticeSettingsPayload = {
        practiceFeedbackMode: updated.practiceFeedbackMode === "without_feedback" ? "without_feedback" : "with_feedback",
        practiceOrderMode: updated.practiceOrderMode === "random" ? "random" : "ordered",
        practiceProgressMode:
          updated.practiceProgressMode === "allow_incorrect_pass" ? "allow_incorrect_pass" : "repeat_until_correct",
      };

      setIndividualPracticeSettingsByExamId((previous) => ({ ...previous, [selectedExam.id]: normalized }));
      setShowIndividualSettingsModal(false);
      setExamFeedback("Configuracion de repaso individual guardada.", "success");
    } catch (saveError) {
      if (saveError instanceof Error) {
        setExamFeedback(saveError.message, "error");
      } else {
        setExamFeedback("No se pudo guardar la configuracion individual.", "error");
      }
    } finally {
      setSavingPracticeSettings(false);
    }
  };

  const onStartPractice = async (examOverride?: ExamSummary, restart = false) => {
    const exam = examOverride ?? selectedExam;
    if (!user || !exam) {
      return;
    }

    const individualSettings = await loadIndividualPracticeSettings(exam);
    const effectiveFeedbackMode = individualSettings.practiceFeedbackMode;
    const effectiveOrderMode = individualSettings.practiceOrderMode;
    const effectiveProgressMode = individualSettings.practiceProgressMode;

    setPracticeFeedbackMode(effectiveFeedbackMode);
    setPracticeOrderMode(effectiveOrderMode);
    setPracticeProgressMode(effectiveProgressMode);
    setSelectedExam(exam);
    setStartingPractice(true);
    try {
      const hadOpenDraft = hasOpenPracticeDraft(exam.id);
      const questions = (await fetchJson(
        `/api/v1/ia/exams/${exam.id}/manual?userId=${user.id}`,
        user.token,
      )) as ExamQuestion[];

      if (questions.length === 0) {
        setExamFeedback("Este examen no tiene preguntas para iniciar repaso.", "error");
        return;
      }

      if (restart) {
        clearPracticeDraft(exam.id);
      }

      let orderedQuestions: ExamQuestion[] = [...questions];
      let restoredIndex = 0;
      let restoredResults: Record<number, PracticeStatus> = {};
      let restoredStartedAt = Date.now();
      const draft = restart ? null : loadPracticeDraft(exam.id);
      const shouldRegisterAttempt = restart || !hadOpenDraft;

      if (draft && draft.questionIds.length > 0) {
        const byId = new Map(questions.map((question) => [question.id, question]));
        const restored = draft.questionIds
          .map((questionId) => byId.get(questionId))
          .filter((question): question is ExamQuestion => question != null);

        const restoredIds = new Set(restored.map((question) => question.id));
        const missing = questions.filter((question) => !restoredIds.has(question.id));
        orderedQuestions = [...restored, ...missing];
        restoredIndex = Math.min(draft.currentIndex, Math.max(orderedQuestions.length - 1, 0));
        restoredResults = draft.results;
        restoredStartedAt = draft.startedAt;
      } else if (effectiveOrderMode === "random") {
        orderedQuestions = [...questions].sort(() => Math.random() - 0.5);
      }

      if (shouldRegisterAttempt) {
        await postJson(`/api/v1/ia/exams/${exam.id}/practice/start`, user.token, {
          userId: user.id,
        });
      }

      setManagedExamQuestions(orderedQuestions);
      setPracticeQuestions(orderedQuestions);
      setPracticeIndex(restoredIndex);
      setPracticeResults(restoredResults);
      setPracticeStartedAt(restoredStartedAt);
      setPracticeFinished(false);
      resetPracticeInputState();
      setShowPracticeModal(false);
      setShowManageModal(false);
      setShowPracticeRunnerModal(true);

      savePracticeDraft(
        exam.id,
        orderedQuestions.map((question) => question.id),
        restoredIndex,
        restoredResults,
        restoredStartedAt,
      );

      if (shouldRegisterAttempt) {
        await refreshExams();
      }

      if (restart) {
        setExamFeedback(
          hadOpenDraft
            ? `Repaso reiniciado con ${orderedQuestions.length} preguntas.`
            : `Repaso iniciado con ${orderedQuestions.length} preguntas.`,
          "success",
        );
      } else if (hadOpenDraft) {
        setExamFeedback("Repaso retomado desde tu ultimo avance.", "success");
      } else {
        setExamFeedback(`Repaso iniciado con ${orderedQuestions.length} preguntas.`, "success");
      }
    } catch (practiceError) {
      if (practiceError instanceof Error) {
        setExamFeedback(practiceError.message, "error");
      } else {
        setExamFeedback("No se pudo iniciar el repaso.", "error");
      }
    } finally {
      setStartingPractice(false);
    }
  };

  const onJoinGroupPractice = async (examOverride?: ExamSummary) => {
    const exam = examOverride ?? selectedExam;
    if (!user || !exam) {
      return;
    }

    suppressGroupRoomClosedModalRef.current = false;
    setSelectedExam(exam);
    setGroupPracticeLoadingExamId(exam.id);
    setGroupPracticeLoading(true);
    try {
      const state = (await postJson(`/api/v1/ia/exams/${exam.id}/practice/group/join`, user.token, {
        userId: user.id,
      })) as ExamGroupState;
      setGroupPracticeState(state);
      setShowPracticeModal(false);
      setShowManageModal(false);
      setShowPracticeRunnerModal(false);
      setShowGroupPracticeRunnerModal(true);
      setPracticeFeedbackStatus(null);
      resetPracticeInputState();
      setExamFeedback("Entraste a la sala de repaso grupal.", "success");
    } catch (groupError) {
      if (groupError instanceof Error) {
        const rawMessage = groupError.message || "";
        if (rawMessage.toLowerCase().includes("recurso no encontrado")) {
          setExamFeedback(
            "No se encontro el endpoint de repaso grupal. Reinicia SmartLearnApi.",
            "error",
          );
        } else if (rawMessage.toLowerCase().includes("no hay repaso grupal creado")) {
          // BUGFIX: Si el usuario dueño hace click en "Regresar al repaso" luego de 20s de inactividad,
          // el backend mata la sesión por timeout y devuelve este error. Si el usuario es quien puede iniciar grupos,
          // re-creamos la sesión automáticamente.
          const isCreator =
            exam.groupPracticeCreatedByUserId === user.id ||
            exam.accessRole === "owner" ||
            exam.ownerUserId === user.id;

          if (isCreator) {
             setExamFeedback("La sesion expiro por inactividad. Creando una nueva...", "error");
             void onCreateGroupPractice(exam);
          } else {
             setExamFeedback("El repaso grupal acabo o caduco por inactividad. Pide al creador que inicie uno nuevo.", "error");
          }
        } else {
          setExamFeedback(rawMessage, "error");
        }
      } else {
        setExamFeedback("No se pudo entrar al repaso grupal.", "error");
      }
    } finally {
      setGroupPracticeLoading(false);
      setGroupPracticeLoadingExamId(null);
    }
  };

  const onCreateGroupPractice = async (examOverride?: ExamSummary) => {
    const exam = examOverride ?? selectedExam;
    if (!user || !exam) {
      return;
    }

    suppressGroupRoomClosedModalRef.current = false;
    setSelectedExam(exam);
    setGroupPracticeLoadingExamId(exam.id);
    setGroupPracticeLoading(true);
    try {
      const state = (await postJson(`/api/v1/ia/exams/${exam.id}/practice/group/create`, user.token, {
        userId: user.id,
      })) as ExamGroupState;
      setGroupPracticeState((previous) => mergeGroupState(previous, state));
      setShowPracticeModal(false);
      setShowManageModal(false);
      setShowPracticeRunnerModal(false);
      setShowGroupPracticeRunnerModal(true);
      setPracticeFeedbackStatus(null);
      resetPracticeInputState();
      setExamFeedback("Repaso grupal creado. Esperando participantes.", "success");
      await refreshExams();
    } catch (groupError) {
      if (groupError instanceof Error) {
        const rawMessage = groupError.message || "";
        if (rawMessage.toLowerCase().includes("recurso no encontrado")) {
          setExamFeedback(
            "No se encontro el endpoint de repaso grupal. Reinicia SmartLearnApi para cargar /practice/group/*.",
            "error",
          );
        } else if (rawMessage.toLowerCase().includes("ya existe un repaso grupal creado")) {
          setExamFeedback("Ya existe un repaso grupal activo. Usa 'Unirse a repaso grupal'.", "error");
        } else {
          setExamFeedback(rawMessage, "error");
        }
      } else {
        setExamFeedback("No se pudo crear el repaso grupal.", "error");
      }
    } finally {
      setGroupPracticeLoading(false);
      setGroupPracticeLoadingExamId(null);
    }
  };

  const onStartGroupPracticeSession = async () => {
    if (!user || !selectedExam || !groupPracticeState) {
      return;
    }
    setGroupPracticeLoading(true);
    try {
      const state = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/start`, user.token, {
        userId: user.id,
        sessionId: groupPracticeState.sessionId,
      })) as ExamGroupState;
      setGroupPracticeState((previous) => mergeGroupState(previous, state));
      setGroupAnswersByQuestionKey({});
      setGroupSubmittedQuestionKey(null);
      setPracticeFeedbackStatus(null);
      resetPracticeInputState();
      setExamFeedback("Repaso grupal iniciado.", "success");
    } catch (startError) {
      if (startError instanceof Error) {
        setExamFeedback(startError.message, "error");
      } else {
        setExamFeedback("No se pudo iniciar el repaso grupal.", "error");
      }
    } finally {
      setGroupPracticeLoading(false);
    }
  };

  const onSubmitGroupPracticeStep = async (forceSubmit = false) => {
    if (!user || !selectedExam || !groupPracticeState || groupPracticeState.status !== "active") {
      return;
    }
    const currentQuestion = groupPracticeState.currentQuestion;
    if (!currentQuestion) {
      return;
    }
    const submitQuestionKey = `${groupPracticeState.sessionId}:${groupPracticeState.currentQuestionIndex}:${currentQuestion.id}`;
    const writtenAnswer = practiceWrittenAnswer.trim();
    const hasDraftForCurrentQuestion = groupDraftQuestionKey === submitQuestionKey;
    const selectedOptionForCurrentQuestion =
      currentQuestion.questionType === "multiple_choice" && hasDraftForCurrentQuestion
        ? practiceSelectedOption
        : null;
    const writtenAnswerForCurrentQuestion =
      currentQuestion.questionType === "multiple_choice"
        ? ""
        : hasDraftForCurrentQuestion
          ? writtenAnswer
          : "";
    const submittedHasContent =
      currentQuestion.questionType === "multiple_choice"
        ? Boolean(selectedOptionForCurrentQuestion)
        : Boolean(writtenAnswerForCurrentQuestion);
    if (!forceSubmit && currentQuestion.questionType === "multiple_choice" && !selectedOptionForCurrentQuestion) {
      setExamFeedback("Selecciona una opcion para responder en grupo.", "error");
      return;
    }
    if (!forceSubmit && currentQuestion.questionType !== "multiple_choice" && !writtenAnswerForCurrentQuestion) {
      setExamFeedback("Escribe una respuesta para continuar.", "error");
      return;
    }

    setSubmittingGroupAnswer(true);
    try {
      const state = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/answer`, user.token, {
        userId: user.id,
        sessionId: groupPracticeState.sessionId,
        questionId: currentQuestion.id,
        selectedOption: currentQuestion.questionType === "multiple_choice" ? selectedOptionForCurrentQuestion : null,
        writtenAnswer:
          currentQuestion.questionType === "multiple_choice" ? null : writtenAnswerForCurrentQuestion || null,
      })) as ExamGroupState;
      let resolvedState: ExamGroupState = state;
      setGroupPracticeState((previousState) => {
        if (!previousState || previousState.sessionId !== state.sessionId) {
          resolvedState = mergeGroupState(previousState, state);
          return resolvedState;
        }

        const previousStatus = (previousState.status ?? "").toLowerCase();
        const nextStatus = (state.status ?? "").toLowerCase();
        const previousIndex = previousState.currentQuestionIndex ?? 0;
        const nextIndex = state.currentQuestionIndex ?? 0;

        // Ignora respuestas tardias que devuelven la pregunta anterior y bloquearian la actual.
        if (previousStatus === "active" && nextStatus === "active" && nextIndex < previousIndex) {
          resolvedState = previousState;
          return previousState;
        }

        resolvedState = mergeGroupState(previousState, state);
        return resolvedState;
      });

      const me = resolvedState.participants.find((participant) => participant.userId === user.id);
      if (me && me.answeredCurrent) {
        if (me.correctCurrent === true) {
          setPracticeFeedbackStatus("correct");
        } else if (me.correctCurrent === false) {
          setPracticeFeedbackStatus("incorrect");
        } else {
          setPracticeFeedbackStatus("unanswered");
        }
      }
      if (forceSubmit) {
        setExamFeedback("Tiempo agotado. Respuesta enviada.", "info");
      } else {
        setExamFeedback("Respuesta grupal enviada.", "success");
      }
      if (submittedHasContent) {
        setGroupSubmittedQuestionKey(submitQuestionKey);
      }
    } catch (answerError) {
      if (answerError instanceof Error) {
        setExamFeedback(answerError.message, "error");
      } else {
        setExamFeedback("No se pudo registrar la respuesta grupal.", "error");
      }
    } finally {
      setSubmittingGroupAnswer(false);
    }
  };

  const onAdvanceGroupPracticeStep = async () => {
    if (!user || !selectedExam || !groupPracticeState) {
      return;
    }
    setAdvancingGroupQuestion(true);
    try {
      const state = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/next`, user.token, {
        userId: user.id,
        sessionId: groupPracticeState.sessionId,
      })) as ExamGroupState;
      setGroupPracticeState((previous) => mergeGroupState(previous, state));
      setPracticeFeedbackStatus(null);
      setGroupTimerExpired(false);
      resetPracticeInputState();
      if (state.status === "finished") {
        setExamFeedback("Repaso grupal finalizado.", "success");
        await refreshExams();
      } else {
        setExamFeedback("Pregunta grupal avanzada.", "info");
      }
    } catch (advanceError) {
      if (advanceError instanceof Error) {
        setExamFeedback(advanceError.message, "error");
      } else {
        setExamFeedback("No se pudo avanzar a la siguiente pregunta.", "error");
      }
    } finally {
      setAdvancingGroupQuestion(false);
    }
  };


  const onCloseAndRestartGroupPractice = async () => {
    if (!user || !selectedExam || !groupPracticeState) {
      window.alert("Error: faltan datos de sesion. Recarga y vuelve a intentar.");
      return;
    }
    setClosingAndRestartingGroupPractice(true);
    const applyWaitingGroupState = (state: ExamGroupState, feedbackMessage: string) => {
      setGroupPracticeState(state);
      setShowPracticeModal(false);
      setShowManageModal(false);
      setShowPracticeRunnerModal(false);
      setShowGroupPracticeRunnerModal(true);
      setGroupQuestionElapsedSeconds(0);
      setGroupQuestionRemainingSeconds(null);
      setGroupAutoSubmitKey(null);
      setGroupTimerExpired(false);
      setGroupTimerExpiredQuestionKey(null);
      setGroupAutoAdvanceSecondsLeft(null);
      groupQuestionRuntimeKeyRef.current = null;
      groupReviewQuestionKeyRef.current = null;
      groupReviewStartedAtMsRef.current = null;
      groupReviewRefreshInFlightRef.current = false;
      setGroupAnswersByQuestionKey({});
      setPracticeFeedbackStatus(null);
      resetPracticeInputState();
      setExamFeedback(feedbackMessage, "success");
    };
    try {
      const currentStatus = (groupPracticeState.status ?? "").toLowerCase();
      if (currentStatus === "active") {
        await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/close`, user.token, {
          userId: user.id,
          sessionId: groupPracticeState.sessionId,
        });
      }

      const waitingState = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/restart`, user.token, {
        userId: user.id,
        sessionId: groupPracticeState.sessionId,
      })) as ExamGroupState;
      applyWaitingGroupState(waitingState, "Examen grupal finalizado. Todos volvieron a sala de espera.");
      await refreshExams();
    } catch (restartError) {
      try {
        const latestState = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/join`, user.token, {
          userId: user.id,
        })) as ExamGroupState;

        const waitingState = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/restart`, user.token, {
          userId: user.id,
          sessionId: latestState.sessionId,
        })) as ExamGroupState;

        applyWaitingGroupState(waitingState, "Examen grupal finalizado y enviado a espera con la sesion mas reciente.");
        await refreshExams();
      } catch (fallbackRestartError) {
        try {
          const createdWaitingState = (await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/create`, user.token, {
            userId: user.id,
          })) as ExamGroupState;
          applyWaitingGroupState(createdWaitingState, "No habia sesion activa. Se creo una nueva sala en espera.");
          await refreshExams();
        } catch (createSessionError) {
          const msg =
            createSessionError instanceof Error
              ? createSessionError.message
              : fallbackRestartError instanceof Error
                ? fallbackRestartError.message
                : restartError instanceof Error
                  ? restartError.message
                  : "No se pudo reiniciar la sesion grupal.";
          setExamFeedback(msg, "error");
          window.alert(`Error al reiniciar el examen grupal: ${msg}`);
        }
      }
    } finally {
      setClosingAndRestartingGroupPractice(false);
    }
  };

  const currentPracticeQuestion = practiceQuestions[practiceIndex] ?? null;

  const practiceStats = useMemo(() => {
    const values = Object.values(practiceResults);
    const correct = values.filter((status) => status === "correct").length;
    const incorrect = values.filter((status) => status === "incorrect").length;
    const unanswered = values.filter((status) => status === "unanswered").length;
    const total = practiceQuestions.length;
    const pending = Math.max(total - values.length, 0);
    return {
      total,
      correct,
      incorrect,
      unanswered: unanswered + pending,
      answered: values.length,
    };
  }, [practiceQuestions.length, practiceResults]);

  const persistCurrentPracticeDraft = (
    nextIndex: number,
    nextResults: Record<number, PracticeStatus>,
    questionSource?: ExamQuestion[],
  ) => {
    if (!selectedExam) {
      return;
    }

    const source = questionSource ?? practiceQuestions;
    savePracticeDraft(
      selectedExam.id,
      source.map((question) => question.id),
      nextIndex,
      nextResults,
      practiceStartedAt || Date.now(),
    );
  };

  const moveToNextPracticeStep = (nextResults: Record<number, PracticeStatus>) => {
    if (!selectedExam) {
      return;
    }

    if (practiceIndex >= practiceQuestions.length - 1) {
      clearPracticeDraft(selectedExam.id);
      setPracticeFinished(true);
      setPracticeFeedbackStatus(null);
      return;
    }

    const nextIndex = practiceIndex + 1;
    setPracticeIndex(nextIndex);
    resetPracticeInputState();
    persistCurrentPracticeDraft(nextIndex, nextResults);
  };

  const restartCurrentPracticeTimer = () => {
    const question = currentPracticeQuestion;
    if (!question) {
      return;
    }
    setPracticeChronoSeconds(0);
    const isTimerEnabled = question.timerEnabled !== false;
    const rawTimeLimit = Number(question.temporizadorSegundos ?? 0);
    if (isTimerEnabled && Number.isFinite(rawTimeLimit) && rawTimeLimit > 0) {
      setPracticeRemainingSeconds(rawTimeLimit);
    } else {
      setPracticeRemainingSeconds(null);
    }
  };

  useEffect(() => {
    if (!showPracticeRunnerModal || practiceFinished || !currentPracticeQuestion) {
      return;
    }

    setPracticeChronoSeconds(0);
    const isTimerEnabled = currentPracticeQuestion.timerEnabled !== false;
    const rawTimeLimit = Number(currentPracticeQuestion.temporizadorSegundos ?? 0);

    if (isTimerEnabled && Number.isFinite(rawTimeLimit) && rawTimeLimit > 0) {
      setPracticeRemainingSeconds(rawTimeLimit);
    } else {
      setPracticeRemainingSeconds(null);
    }
  }, [showPracticeRunnerModal, practiceFinished, currentPracticeQuestion?.id]);

  useEffect(() => {
    if (!showPracticeRunnerModal || practiceFinished || !currentPracticeQuestion) {
      return;
    }

    if (practiceFeedbackStatus != null) {
      return;
    }

    const tickHandle = window.setTimeout(() => {
      setPracticeChronoSeconds((prev) => prev + 1);

      if (practiceRemainingSeconds == null) {
        return;
      }

      if (practiceRemainingSeconds <= 1) {
        const timeoutStatus: PracticeStatus = "unanswered";
        const nextResults = { ...practiceResults, [currentPracticeQuestion.id]: timeoutStatus };
        setPracticeResults(nextResults);
        setPracticeRemainingSeconds(0);

        if (practiceFeedbackMode === "with_feedback" || practiceProgressMode === "repeat_until_correct") {
          setPracticeFeedbackStatus(timeoutStatus);
        } else {
          moveToNextPracticeStep(nextResults);
        }
        return;
      }

      setPracticeRemainingSeconds(practiceRemainingSeconds - 1);
    }, 1000);

    return () => window.clearTimeout(tickHandle);
  }, [
    showPracticeRunnerModal,
    practiceFinished,
    currentPracticeQuestion,
    practiceFeedbackStatus,
    practiceRemainingSeconds,
    practiceResults,
    practiceFeedbackMode,
    practiceProgressMode,
  ]);

  const onSubmitPracticeStep = () => {
    const question = currentPracticeQuestion;
    if (!question) {
      return;
    }

    let status: PracticeStatus;
    if (question.questionType === "multiple_choice") {
      if (!practiceSelectedOption) {
        status = "unanswered";
      } else {
        status = resolveCorrectOption(question) === practiceSelectedOption ? "correct" : "incorrect";
      }
    } else {
      if (!practiceWrittenAnswer.trim()) {
        status = "unanswered";
      } else {
        const correctValue = normalizeAnswer(question.correctAnswer ?? "");
        status = normalizeAnswer(practiceWrittenAnswer) === correctValue ? "correct" : "incorrect";
      }
    }

    const nextResults = { ...practiceResults, [question.id]: status };
    setPracticeResults(nextResults);

    if (practiceFeedbackMode === "with_feedback") {
      setPracticeFeedbackStatus(status);
      persistCurrentPracticeDraft(practiceIndex, nextResults);
      return;
    }

    if (practiceProgressMode === "repeat_until_correct" && status !== "correct") {
      setPracticeFeedbackStatus(status);
      persistCurrentPracticeDraft(practiceIndex, nextResults);
      return;
    }

    moveToNextPracticeStep(nextResults);
  };

  const onContinuePracticeAfterFeedback = () => {
    if (practiceFeedbackStatus == null) {
      return;
    }

    if (practiceProgressMode === "repeat_until_correct" && practiceFeedbackStatus !== "correct") {
      restartCurrentPracticeTimer();
      resetPracticeInputState();
      return;
    }

    moveToNextPracticeStep(practiceResults);
  };

  useEffect(() => {
    const currentPracticeType = (currentPracticeQuestion?.questionType ?? "").toLowerCase();
    const currentGroupType = (groupPracticeState?.currentQuestion?.questionType ?? "").toLowerCase();

    const canSubmitIndividualWithEnter =
      showPracticeRunnerModal &&
      !practiceFinished &&
      practiceFeedbackStatus == null &&
      currentPracticeType === "multiple_choice";
    const canSubmitGroupWithEnter =
      showGroupPracticeRunnerModal &&
      groupPracticeState?.status === "active" &&
      groupAutoAdvanceSecondsLeft == null &&
      !submittingGroupAnswer &&
      currentGroupType === "multiple_choice";

    if (!canSubmitIndividualWithEnter && !canSubmitGroupWithEnter) {
      return;
    }

    const handleEnterToSubmit = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) {
        return;
      }
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (target instanceof HTMLInputElement && target.type !== "radio") {
        return;
      }

      if (canSubmitGroupWithEnter) {
        const currentGroupQuestionKey = buildGroupQuestionKey(groupPracticeState ?? null);
        const hasCurrentDraftSelection =
          currentGroupQuestionKey != null &&
          groupDraftQuestionKey === currentGroupQuestionKey &&
          Boolean(practiceSelectedOption);
        if (!hasCurrentDraftSelection) {
          return;
        }
        event.preventDefault();
        void onSubmitGroupPracticeStep();
        return;
      }

      if (canSubmitIndividualWithEnter) {
        if (!practiceSelectedOption) {
          return;
        }
        event.preventDefault();
        onSubmitPracticeStep();
      }
    };

    window.addEventListener("keydown", handleEnterToSubmit);
    return () => window.removeEventListener("keydown", handleEnterToSubmit);
  }, [
    currentPracticeQuestion?.questionType,
    groupPracticeState,
    groupAutoAdvanceSecondsLeft,
    groupDraftQuestionKey,
    onSubmitGroupPracticeStep,
    onSubmitPracticeStep,
    practiceFeedbackStatus,
    practiceFinished,
    practiceSelectedOption,
    showGroupPracticeRunnerModal,
    showPracticeRunnerModal,
    submittingGroupAnswer,
  ]);

  const onClosePracticeRunner = () => {
    if (selectedExam && !practiceFinished) {
      persistCurrentPracticeDraft(practiceIndex, practiceResults);
      setExamFeedback("Progreso guardado. Puedes continuar el repaso cuando quieras.", "info");
    }
    setShowPracticeRunnerModal(false);
    setPracticeIntent("start");
    setActive(practiceOriginSection === "ia" ? "ia" : practiceOriginSection === "cursos" ? "cursos" : "examenes");
  };

  const onClosePracticeRunnerWithoutSave = () => {
    if (selectedExam) {
      clearPracticeDraft(selectedExam.id);
    }
    setShowPracticeRunnerModal(false);
    setPracticeQuestions([]);
    setPracticeResults({});
    setPracticeFinished(false);
    setPracticeIndex(0);
    setPracticeIntent("start");
    resetPracticeInputState();
    setExamFeedback("Saliste del repaso sin guardar avance.", "info");
    setActive(practiceOriginSection === "ia" ? "ia" : practiceOriginSection === "cursos" ? "cursos" : "examenes");
  };

  const onCloseGroupPracticeRunner = () => {
    suppressGroupRoomClosedModalRef.current = false;
    if (user) {
      window.localStorage.removeItem(dashboardGroupPracticeViewKey(user.id));
    }
    setShowGroupRoomClosedModal(false);
    setGroupRoomClosedKeepViewing(false);
    setGroupRoomClosedAllowKeepViewing(true);
    setShowGroupPracticeRunnerModal(false);
    setGroupPracticeState(null);
    setGroupAnswersByQuestionKey({});
    setPracticeIntent("start");
    setPracticeFeedbackStatus(null);
    setGroupQuestionElapsedSeconds(0);
    setGroupQuestionRemainingSeconds(null);
    setGroupAutoSubmitKey(null);
    setGroupTimerExpired(false);
    groupQuestionRuntimeKeyRef.current = null;
    resetPracticeInputState();
    setActive(practiceOriginSection === "ia" ? "ia" : practiceOriginSection === "cursos" ? "cursos" : "examenes");
  };

  const onKeepViewingClosedGroupRoomResult = () => {
    if (!groupRoomClosedAllowKeepViewing) {
      onGoToExamsAfterGroupRoomClosed();
      return;
    }
    setShowGroupRoomClosedModal(false);
    setGroupRoomClosedKeepViewing(true);
    setExamFeedback("La sala fue cerrada por el anfitrion. Puedes seguir viendo el resultado final.", "info");
  };

  const onGoToExamsAfterGroupRoomClosed = () => {
    setShowGroupRoomClosedModal(false);
    setGroupRoomClosedKeepViewing(false);
    setGroupRoomClosedAllowKeepViewing(true);
    onCloseGroupPracticeRunner();
    setActive("examenes");
  };

  const onCloseGroupWaitingRoom = async () => {
    if (!user || !selectedExam || !groupPracticeState) {
      return;
    }

    suppressGroupRoomClosedModalRef.current = true;
    setClosingGroupWaitingRoom(true);
    try {
      await postJson(`/api/v1/ia/exams/${selectedExam.id}/practice/group/close`, user.token, {
        userId: user.id,
        sessionId: groupPracticeState.sessionId,
      });

      onCloseGroupPracticeRunner();
      setExamFeedback("Sala de espera cerrada. Regresaste al modulo de examenes.", "success");
      await refreshExams();
    } catch (closeError) {
      suppressGroupRoomClosedModalRef.current = false;
      if (closeError instanceof Error) {
        setExamFeedback(closeError.message, "error");
      } else {
        setExamFeedback("No se pudo cerrar la sala de espera.", "error");
      }
    } finally {
      setClosingGroupWaitingRoom(false);
    }
  };


  useEffect(() => {
    if (
      !showGroupPracticeRunnerModal ||
      !user ||
      !selectedExam ||
      !groupPracticeState ||
      showGroupRoomClosedModal ||
      groupRoomClosedKeepViewing
    ) {
      return;
    }
    const sessionId = groupPracticeState.sessionId;
    const examId = selectedExam.id;

    const applyLatestSessionState = (latestState: ExamGroupState) => {
      setGroupPracticeState((previous) => mergeGroupState(previous, latestState));
      setGroupTimerExpired(false);
      setGroupTimerExpiredQuestionKey(null);
      setGroupAutoSubmitKey(null);
      setGroupAutoAdvanceSecondsLeft(null);
      setPracticeFeedbackStatus(null);
      groupReviewQuestionKeyRef.current = null;
      groupReviewStartedAtMsRef.current = null;
      resetPracticeInputState();
    };

    const shouldAttemptSessionRecovery = (error: unknown): boolean => {
      if (!(error instanceof Error)) {
        return false;
      }
      const normalizedMessage = error.message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return (
        normalizedMessage.includes("sesion grupal no encontrada") ||
        normalizedMessage.includes("session not found") ||
        normalizedMessage.includes("resource not found") ||
        normalizedMessage.includes("recurso no encontrado")
      );
    };

    const pollHandle = window.setInterval(() => {
      if (groupStatePollInFlightRef.current) {
        return;
      }
      void (async () => {
        groupStatePollInFlightRef.current = true;
        try {
          const state = (await fetchJson(
            `/api/v1/ia/exams/${examId}/practice/group/state?userId=${user.id}&sessionId=${sessionId}&ts=${Date.now()}`,
            user.token,
          )) as ExamGroupState;
          setGroupPracticeState((previous) => mergeGroupState(previous, state));

          const normalizedStatus = (state.status ?? "").toLowerCase();
          const waitingRoomClosedByHost = normalizedStatus === "finished" && Number(state.totalQuestions ?? 0) <= 0;
          if (waitingRoomClosedByHost) {
            if (suppressGroupRoomClosedModalRef.current) {
              return;
            }
            setGroupRoomClosedMessage("La sala de espera fue cerrada por el anfitrion. Debes volver al modulo de examenes.");
            setGroupRoomClosedAllowKeepViewing(false);
            setShowGroupRoomClosedModal(true);
            setGroupRoomClosedKeepViewing(false);
            if (user) {
              window.localStorage.removeItem(dashboardGroupPracticeViewKey(user.id));
            }
            return;
          }
        } catch (pollError) {
          if (!shouldAttemptSessionRecovery(pollError)) {
            return;
          }
          try {
            const latestState = (await postJson(
              `/api/v1/ia/exams/${examId}/practice/group/join`,
              user.token,
              { userId: user.id },
            )) as ExamGroupState;
            if (latestState && latestState.sessionId !== sessionId) {
              applyLatestSessionState(latestState);
            } else if (latestState) {
              setGroupPracticeState((previous) => mergeGroupState(previous, latestState));
            }
          } catch {
            if (suppressGroupRoomClosedModalRef.current) {
              return;
            }
            setGroupRoomClosedMessage(
              "La sala de espera fue cerrada por el anfitrion. Deseas quedarte viendo el resultado final o volver al modulo de examenes?",
            );
            setGroupRoomClosedAllowKeepViewing(true);
            setShowGroupRoomClosedModal(true);
            setGroupRoomClosedKeepViewing(false);
            if (user) {
              window.localStorage.removeItem(dashboardGroupPracticeViewKey(user.id));
            }
          }
        } finally {
          groupStatePollInFlightRef.current = false;
        }
      })();
    }, 1000);

    return () => {
      window.clearInterval(pollHandle);
      groupStatePollInFlightRef.current = false;
    };
  }, [
    showGroupPracticeRunnerModal,
    showGroupRoomClosedModal,
    groupRoomClosedKeepViewing,
    user,
    selectedExam,
    groupPracticeState?.sessionId,
  ]);

  useEffect(() => {
    if (!showGroupPracticeRunnerModal || !groupPracticeState) {
      return;
    }

    const questionKey = buildGroupQuestionKey(groupPracticeState);
    if (!questionKey) {
      return;
    }

    const incomingAnswers = groupPracticeState.currentAnswers ?? [];
    if (incomingAnswers.length === 0) {
      return;
    }

    setGroupAnswersByQuestionKey((previous) => {
      const current = previous[questionKey] ?? [];
      const mergedByUser = new Map<string, ExamGroupCurrentAnswer>();
      for (const item of current) {
        mergedByUser.set(normalizeGroupUserKey(item.userId), item);
      }
      for (const item of incomingAnswers) {
        const key = normalizeGroupUserKey(item.userId);
        const existing = mergedByUser.get(key);
        if (!existing) {
          mergedByUser.set(key, item);
          continue;
        }

        const incomingText = (item.selectedAnswer ?? "").trim();
        const existingText = (existing.selectedAnswer ?? "").trim();
        mergedByUser.set(key, {
          ...existing,
          ...item,
          selectedAnswer: incomingText || existingText,
        });
      }

      return {
        ...previous,
        [questionKey]: Array.from(mergedByUser.values()),
      };
    });
  }, [showGroupPracticeRunnerModal, groupPracticeState]);


  useEffect(() => {
    if (!showGroupPracticeRunnerModal || !groupPracticeState || groupPracticeState.status !== "active" || !groupPracticeState.currentQuestion) {
      setGroupQuestionElapsedSeconds(0);
      setGroupQuestionRemainingSeconds(null);
      groupQuestionRuntimeKeyRef.current = null;
      return;
    }

    const questionRuntimeKey = `${groupPracticeState.sessionId}:${groupPracticeState.currentQuestionIndex}:${groupPracticeState.currentQuestion.id}`;
    const timerLimit = Math.max(0, groupPracticeState.currentQuestion.temporizadorSegundos ?? 0);
    const parsedStartedAt = toMillisOrZero(groupQuestionStartedAtEpochMs ?? groupQuestionStartedAt);
    const startedAtMs = parsedStartedAt > 0 ? parsedStartedAt : Date.now();
    if (groupQuestionRuntimeKeyRef.current !== questionRuntimeKey) {
      groupQuestionRuntimeKeyRef.current = questionRuntimeKey;
      setGroupTimerExpired(false);
      setGroupTimerExpiredQuestionKey(null);
      setGroupAutoSubmitKey(null);
      setGroupAutoAdvanceSecondsLeft(null);
      setGroupQuestionElapsedSeconds(0);
      setGroupQuestionRemainingSeconds(timerLimit > 0 ? timerLimit : null);
    }

    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      setGroupQuestionElapsedSeconds(elapsed);
      if (timerLimit > 0) {
        setGroupQuestionRemainingSeconds(Math.max(0, timerLimit - elapsed));
      } else {
        setGroupQuestionRemainingSeconds(null);
      }
    };

    tick();
    const intervalHandle = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalHandle);
  }, [
    showGroupPracticeRunnerModal,
    groupPracticeState?.sessionId,
    groupPracticeState?.status,
    groupPracticeState?.currentQuestionIndex,
    groupPracticeState?.currentQuestion?.id,
    groupPracticeState?.currentQuestion?.temporizadorSegundos,
    groupQuestionStartedAt,
    groupQuestionStartedAtEpochMs,
  ]);

  useEffect(() => {
    if (!showGroupPracticeRunnerModal || !groupPracticeState || groupPracticeState.status !== "active" || !groupPracticeState.currentQuestion) {
      groupInputQuestionKeyRef.current = null;
      return;
    }

    const questionInputKey = `${groupPracticeState.sessionId}:${groupPracticeState.currentQuestionIndex}:${groupPracticeState.currentQuestion.id}`;
    if (groupInputQuestionKeyRef.current === questionInputKey) {
      return;
    }

    groupInputQuestionKeyRef.current = questionInputKey;
    // Limpia cualquier seleccion previa cuando cambia de pregunta.
    setPracticeSelectedOption(null);
    setPracticeWrittenAnswer("");
    setPracticeFeedbackStatus(null);
    setGroupSubmittedQuestionKey(null);
    setGroupDraftQuestionKey(null);
  }, [
    showGroupPracticeRunnerModal,
    groupPracticeState?.sessionId,
    groupPracticeState?.status,
    groupPracticeState?.currentQuestionIndex,
    groupPracticeState?.currentQuestion?.id,
  ]);

  useEffect(() => {
    if (!showGroupPracticeRunnerModal || !groupPracticeState) {
      return;
    }

    const status = (groupPracticeState.status ?? "").toLowerCase();
    if (status === "waiting" || status === "finished") {
      setGroupAnswersByQuestionKey({});
      setGroupSubmittedQuestionKey(null);
      setGroupDraftQuestionKey(null);
      groupInputQuestionKeyRef.current = null;
    }
  }, [
    showGroupPracticeRunnerModal,
    groupPracticeState?.sessionId,
    groupPracticeState?.status,
  ]);

  useEffect(() => {
    if (!showGroupPracticeRunnerModal || !user || !selectedExam || !groupPracticeState || groupPracticeState.status !== "active" || !groupPracticeState.currentQuestion) {
      return;
    }
    if (groupQuestionRemainingSeconds == null || groupQuestionRemainingSeconds > 0) {
      return;
    }

    const questionKey = `${groupPracticeState.sessionId}:${groupPracticeState.currentQuestionIndex}:${groupPracticeState.currentQuestion.id}`;

    // Evita auto-envios usando el "0s" de la pregunta anterior.
    if (groupQuestionRuntimeKeyRef.current !== questionKey) {
      return;
    }

    // Marcar cronómetro como expirado para mostrar resultados
    setGroupTimerExpired(true);
    setGroupTimerExpiredQuestionKey(questionKey);

    const me = groupPracticeState.participants.find((participant) => participant.userId === user.id);
    if (me?.answeredCurrent || submittingGroupAnswer) {
      return;
    }

    if (groupAutoSubmitKey === questionKey) {
      return;
    }

    setGroupAutoSubmitKey(questionKey);
    void onSubmitGroupPracticeStep(true);
  }, [
    showGroupPracticeRunnerModal,
    user,
    selectedExam,
    groupPracticeState,
    groupQuestionRemainingSeconds,
    groupAutoSubmitKey,
    submittingGroupAnswer,
  ]);

  useEffect(() => {
    const isActive =
      showGroupPracticeRunnerModal &&
      Boolean(groupPracticeState) &&
      groupPracticeState?.status === "active" &&
      Boolean(groupPracticeState?.currentQuestion);

    if (!isActive) {
      setGroupAutoAdvanceSecondsLeft(null);
      groupReviewQuestionKeyRef.current = null;
      groupReviewStartedAtMsRef.current = null;
      return;
    }

    const currentQuestionKey =
      groupPracticeState && groupPracticeState.currentQuestion
        ? `${groupPracticeState.sessionId}:${groupPracticeState.currentQuestionIndex}:${groupPracticeState.currentQuestion.id}`
        : null;
    const connectedParticipants = (groupPracticeState?.participants ?? []).filter((participant) =>
      Boolean(participant.connected),
    );
    const answeredUsers = new Set(
      (groupPracticeState?.currentAnswers ?? [])
        .filter((answer) => (answer.selectedAnswer ?? "").trim() !== "")
        .map((answer) => normalizeGroupUserKey(answer.userId)),
    );
    const allAnswered =
      connectedParticipants.length > 0 &&
      connectedParticipants.every((participant) => answeredUsers.has(normalizeGroupUserKey(participant.userId)));
    const expiredForCurrent =
      Boolean(groupTimerExpired) &&
      currentQuestionKey != null &&
      groupTimerExpiredQuestionKey === currentQuestionKey;
    const shouldRevealResults = expiredForCurrent || allAnswered;
    const hasActiveReviewWindow =
      currentQuestionKey != null &&
      groupReviewQuestionKeyRef.current === currentQuestionKey &&
      groupReviewStartedAtMsRef.current != null;
    if (currentQuestionKey == null || (!shouldRevealResults && !hasActiveReviewWindow)) {
      setGroupAutoAdvanceSecondsLeft(null);
      groupReviewQuestionKeyRef.current = null;
      groupReviewStartedAtMsRef.current = null;
      return;
    }

    const revealSeconds = Math.max(1, Number(groupPracticeState.currentQuestion?.reviewSeconds ?? 10));
    const isNewReviewWindow = groupReviewQuestionKeyRef.current !== currentQuestionKey;
    if (isNewReviewWindow || groupReviewStartedAtMsRef.current == null) {
      groupReviewQuestionKeyRef.current = currentQuestionKey;
      groupReviewStartedAtMsRef.current = Date.now();
      setGroupAutoAdvanceSecondsLeft(revealSeconds);
    }

    const reviewStartedAt = groupReviewStartedAtMsRef.current;
    if (reviewStartedAt == null) {
      return;
    }

    const refreshReviewState = () => {
      if (!user || !selectedExam || !groupPracticeState) {
        return;
      }
      if (groupReviewRefreshInFlightRef.current) {
        return;
      }
      const sessionId = groupPracticeState.sessionId;
      const examId = selectedExam.id;
      const userId = user.id;
      const token = user.token;
      groupReviewRefreshInFlightRef.current = true;
      void (async () => {
        try {
          const freshState = (await fetchJson(
            `/api/v1/ia/exams/${examId}/practice/group/state?userId=${userId}&sessionId=${sessionId}&ts=${Date.now()}`,
            token,
          )) as ExamGroupState;
          setGroupPracticeState((previous) => mergeGroupState(previous, freshState));
        } catch {
          // silencio: el polling principal seguirá intentando.
        } finally {
          groupReviewRefreshInFlightRef.current = false;
        }
      })();
    };

    // Forzar un refresh inmediato al entrar a revisión para no mostrar snapshots viejos.
    if (isNewReviewWindow) {
      refreshReviewState();
    }

    const updateCountdown = () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - reviewStartedAt) / 1000));
      const remaining = Math.max(0, revealSeconds - elapsedSeconds);
      setGroupAutoAdvanceSecondsLeft(remaining);
      return remaining;
    };

    updateCountdown();
    const countdownHandle = window.setInterval(() => {
      updateCountdown();
    }, 1000);
    const refreshHandle = window.setInterval(() => {
      refreshReviewState();
    }, 2500);

    const elapsedMs = Math.max(0, Date.now() - reviewStartedAt);
    const remainingMs = Math.max(0, revealSeconds * 1000 - elapsedMs);

    const timeoutHandle = window.setTimeout(() => {
      if (groupCanStartGroup && !advancingGroupQuestion) {
        void onAdvanceGroupPracticeStep();
      }
    }, remainingMs);

    return () => {
      window.clearInterval(countdownHandle);
      window.clearInterval(refreshHandle);
      window.clearTimeout(timeoutHandle);
      groupReviewRefreshInFlightRef.current = false;
    };
  }, [
    showGroupPracticeRunnerModal,
    groupPracticeState?.status,
    groupPracticeState?.sessionId,
    groupPracticeState?.currentQuestionIndex,
    groupPracticeState?.currentQuestion?.id,
    groupPracticeState?.allAnsweredCurrent,
    user,
    selectedExam,
    groupTimerExpired,
    groupTimerExpiredQuestionKey,
    groupCanStartGroup,
    advancingGroupQuestion,
  ]);

  const selectedSala = useMemo(
    () => (selectedSalaId == null ? null : salasData.find((sala) => sala.id === selectedSalaId) ?? null),
    [salasData, selectedSalaId],
  );

  useEffect(() => {
    if (!selectedSala) {
      setSalaPinnedScreenParticipantId(null);
      setSalaMaximizedScreenParticipantId(null);
      setSalaPinnedZoom(1);
      setSalaPinnedPanX(0);
      setSalaPinnedPanY(0);
      setSalaMaxZoom(1);
      setSalaMaxPanX(0);
      setSalaMaxPanY(0);
      setSalaControlRequestPending(false);
      setSalaControlRequestTargetId(null);
      setSalaControlGrantedParticipantId(null);
      setSalaRemotePointerX(50);
      setSalaRemotePointerY(50);
      setSalaRemoteInputDraft("");
      setSalaRemoteLastCommand("");
      return;
    }
    const sharingParticipants = selectedSala.participants.filter((participant) => participant.isScreenSharing);
    if (sharingParticipants.length === 0) {
      setSalaPinnedScreenParticipantId(null);
      setSalaMaximizedScreenParticipantId(null);
      setSalaPinnedZoom(1);
      setSalaPinnedPanX(0);
      setSalaPinnedPanY(0);
      setSalaMaxZoom(1);
      setSalaMaxPanX(0);
      setSalaMaxPanY(0);
      setSalaControlRequestPending(false);
      setSalaControlRequestTargetId(null);
      setSalaControlGrantedParticipantId(null);
      setSalaRemotePointerX(50);
      setSalaRemotePointerY(50);
      setSalaRemoteInputDraft("");
      setSalaRemoteLastCommand("");
      return;
    }
    setSalaPinnedScreenParticipantId((current) => {
      if (current != null && sharingParticipants.some((participant) => participant.id === current)) {
        return current;
      }
      return sharingParticipants[0].id;
    });
    setSalaMaximizedScreenParticipantId((current) => {
      if (current != null && sharingParticipants.some((participant) => participant.id === current)) {
        return current;
      }
      return null;
    });
    setSalaControlRequestTargetId((current) =>
      current != null && sharingParticipants.some((participant) => participant.id === current) ? current : null,
    );
    setSalaControlGrantedParticipantId((current) =>
      current != null && sharingParticipants.some((participant) => participant.id === current) ? current : null,
    );
    if (
      salaControlRequestPending &&
      (salaControlRequestTargetId == null ||
        !sharingParticipants.some((participant) => participant.id === salaControlRequestTargetId))
    ) {
      setSalaControlRequestPending(false);
    }
  }, [selectedSala]);

  const clampSalaZoom = (value: number) => Math.min(3, Math.max(1, value));
  const clampSalaPan = (value: number, zoom: number) => {
    const limit = Math.max(0, ((zoom - 1) / 2) * 100);
    return Math.max(-limit, Math.min(limit, value));
  };

  const onAdjustPinnedZoom = (delta: number) => {
    setSalaPinnedZoom((current) => {
      const next = clampSalaZoom(current + delta);
      setSalaPinnedPanX((prev) => clampSalaPan(prev, next));
      setSalaPinnedPanY((prev) => clampSalaPan(prev, next));
      return next;
    });
  };

  const onMovePinnedScreen = (deltaX: number, deltaY: number) => {
    setSalaPinnedPanX((current) => clampSalaPan(current + deltaX, salaPinnedZoom));
    setSalaPinnedPanY((current) => clampSalaPan(current + deltaY, salaPinnedZoom));
  };

  const onResetPinnedScreen = () => {
    setSalaPinnedZoom(1);
    setSalaPinnedPanX(0);
    setSalaPinnedPanY(0);
  };

  const onAdjustMaxZoom = (delta: number) => {
    setSalaMaxZoom((current) => {
      const next = clampSalaZoom(current + delta);
      setSalaMaxPanX((prev) => clampSalaPan(prev, next));
      setSalaMaxPanY((prev) => clampSalaPan(prev, next));
      return next;
    });
  };

  const onMoveMaxScreen = (deltaX: number, deltaY: number) => {
    setSalaMaxPanX((current) => clampSalaPan(current + deltaX, salaMaxZoom));
    setSalaMaxPanY((current) => clampSalaPan(current + deltaY, salaMaxZoom));
  };

  const onResetMaxScreen = () => {
    setSalaMaxZoom(1);
    setSalaMaxPanX(0);
    setSalaMaxPanY(0);
  };

  const onStartPinnedScreenDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || salaPinnedZoom <= 1) {
      return;
    }
    const viewport = salaPinnedViewportRef.current;
    if (!viewport) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = salaPinnedPanX;
    const startPanY = salaPinnedPanY;
    const viewportWidth = viewport.clientWidth || 1;
    const viewportHeight = viewport.clientHeight || 1;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextPanX = startPanX + ((moveEvent.clientX - startX) / viewportWidth) * 100;
      const nextPanY = startPanY + ((moveEvent.clientY - startY) / viewportHeight) * 100;
      setSalaPinnedPanX(clampSalaPan(nextPanX, salaPinnedZoom));
      setSalaPinnedPanY(clampSalaPan(nextPanY, salaPinnedZoom));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const onStartPinnedScreenTouch = (event: TouchEvent<HTMLDivElement>) => {
    if (salaPinnedZoom <= 1) {
      return;
    }
    const viewport = salaPinnedViewportRef.current;
    if (!viewport) {
      return;
    }
    const firstTouch = event.touches[0];
    if (!firstTouch) {
      return;
    }
    event.preventDefault();
    const startX = firstTouch.clientX;
    const startY = firstTouch.clientY;
    const startPanX = salaPinnedPanX;
    const startPanY = salaPinnedPanY;
    const viewportWidth = viewport.clientWidth || 1;
    const viewportHeight = viewport.clientHeight || 1;
    const handleTouchMove = (moveEvent: globalThis.TouchEvent) => {
      const touchPoint = moveEvent.touches[0];
      if (!touchPoint) {
        return;
      }
      moveEvent.preventDefault();
      const nextPanX = startPanX + ((touchPoint.clientX - startX) / viewportWidth) * 100;
      const nextPanY = startPanY + ((touchPoint.clientY - startY) / viewportHeight) * 100;
      setSalaPinnedPanX(clampSalaPan(nextPanX, salaPinnedZoom));
      setSalaPinnedPanY(clampSalaPan(nextPanY, salaPinnedZoom));
    };
    const handleTouchEnd = () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
  };

  const onStartMaxScreenDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || salaMaxZoom <= 1) {
      return;
    }
    const viewport = salaMaxViewportRef.current;
    if (!viewport) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = salaMaxPanX;
    const startPanY = salaMaxPanY;
    const viewportWidth = viewport.clientWidth || 1;
    const viewportHeight = viewport.clientHeight || 1;
    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextPanX = startPanX + ((moveEvent.clientX - startX) / viewportWidth) * 100;
      const nextPanY = startPanY + ((moveEvent.clientY - startY) / viewportHeight) * 100;
      setSalaMaxPanX(clampSalaPan(nextPanX, salaMaxZoom));
      setSalaMaxPanY(clampSalaPan(nextPanY, salaMaxZoom));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const onStartMaxScreenTouch = (event: TouchEvent<HTMLDivElement>) => {
    if (salaMaxZoom <= 1) {
      return;
    }
    const viewport = salaMaxViewportRef.current;
    if (!viewport) {
      return;
    }
    const firstTouch = event.touches[0];
    if (!firstTouch) {
      return;
    }
    event.preventDefault();
    const startX = firstTouch.clientX;
    const startY = firstTouch.clientY;
    const startPanX = salaMaxPanX;
    const startPanY = salaMaxPanY;
    const viewportWidth = viewport.clientWidth || 1;
    const viewportHeight = viewport.clientHeight || 1;
    const handleTouchMove = (moveEvent: globalThis.TouchEvent) => {
      const touchPoint = moveEvent.touches[0];
      if (!touchPoint) {
        return;
      }
      moveEvent.preventDefault();
      const nextPanX = startPanX + ((touchPoint.clientX - startX) / viewportWidth) * 100;
      const nextPanY = startPanY + ((touchPoint.clientY - startY) / viewportHeight) * 100;
      setSalaMaxPanX(clampSalaPan(nextPanX, salaMaxZoom));
      setSalaMaxPanY(clampSalaPan(nextPanY, salaMaxZoom));
    };
    const handleTouchEnd = () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
  };

  const onOpenSalaMaximizedScreen = (participantId: number) => {
    setSalaMaximizedScreenParticipantId(participantId);
    setSalaMaxZoom(salaPinnedZoom);
    setSalaMaxPanX(salaPinnedPanX);
    setSalaMaxPanY(salaPinnedPanY);
  };

  const onRequestSalaControl = (participantId: number) => {
    setSalaControlRequestPending(true);
    setSalaControlRequestTargetId(participantId);
    setSalaControlGrantedParticipantId(null);
    setSalaRemotePointerX(50);
    setSalaRemotePointerY(50);
    setSalaRemoteInputDraft("");
    setSalaRemoteLastCommand("");
    setSalaFeedback("Solicitud de control enviada. Esperando aprobacion del anfitrion.", "info");
  };

  const onApproveSalaControlRequest = () => {
    if (!salaControlRequestPending || salaControlRequestTargetId == null) {
      return;
    }
    setSalaControlGrantedParticipantId(salaControlRequestTargetId);
    setSalaControlRequestPending(false);
    setSalaRemotePointerX(50);
    setSalaRemotePointerY(50);
    setSalaFeedback("Control remoto concedido (simulado). Ya puedes mover el mouse y enviar texto.", "success");
  };

  const onRejectSalaControlRequest = () => {
    setSalaControlRequestPending(false);
    setSalaControlRequestTargetId(null);
    setSalaControlGrantedParticipantId(null);
    setSalaRemoteInputDraft("");
    setSalaRemoteLastCommand("");
    setSalaFeedback("Solicitud de control rechazada (simulado).", "error");
  };

  const onReleaseSalaControl = () => {
    setSalaControlRequestPending(false);
    setSalaControlRequestTargetId(null);
    setSalaControlGrantedParticipantId(null);
    setSalaRemotePointerX(50);
    setSalaRemotePointerY(50);
    setSalaRemoteInputDraft("");
    setSalaRemoteLastCommand("");
    setSalaFeedback("Control remoto liberado.", "info");
  };

  const onMoveSalaRemotePointer = (event: MouseEvent<HTMLDivElement>, scope: "pinned" | "max") => {
    const activeTargetId = scope === "pinned" ? salaPinnedScreenParticipantId : salaMaximizedScreenParticipantId;
    if (salaControlGrantedParticipantId == null || activeTargetId == null || salaControlGrantedParticipantId !== activeTargetId) {
      return;
    }
    const viewport = scope === "pinned" ? salaPinnedViewportRef.current : salaMaxViewportRef.current;
    if (!viewport) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const nextX = ((event.clientX - rect.left) / rect.width) * 100;
    const nextY = ((event.clientY - rect.top) / rect.height) * 100;
    setSalaRemotePointerX(Math.max(0, Math.min(100, nextX)));
    setSalaRemotePointerY(Math.max(0, Math.min(100, nextY)));
  };

  const onSubmitSalaRemoteInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCommand = salaRemoteInputDraft.trim();
    if (!nextCommand) {
      return;
    }
    setSalaRemoteLastCommand(nextCommand);
    setSalaRemoteInputDraft("");
    setSalaFeedback("Entrada de teclado enviada (simulada).", "success");
  };

  const onOpenSala = (salaId: number) => {
    const room = salasData.find((sala) => sala.id === salaId) ?? null;
    const firstScreenSharingParticipantId = room?.participants.find((participant) => participant.isScreenSharing)?.id ?? null;
    setSelectedSalaId(salaId);
    setSalasSharedScreensOpen(true);
    setSalaDraftMessage("");
    setSalaActionMenuId(null);
    setSalaPinnedScreenParticipantId(firstScreenSharingParticipantId);
    setSalaMaximizedScreenParticipantId(null);
    setSalaPinnedZoom(1);
    setSalaPinnedPanX(0);
    setSalaPinnedPanY(0);
    setSalaMaxZoom(1);
    setSalaMaxPanX(0);
    setSalaMaxPanY(0);
    setSalaControlRequestPending(false);
    setSalaControlRequestTargetId(null);
    setSalaControlGrantedParticipantId(null);
    setSalaRemotePointerX(50);
    setSalaRemotePointerY(50);
    setSalaRemoteInputDraft("");
    setSalaRemoteLastCommand("");
  };

  const onBackToSalas = () => {
    setSelectedSalaId(null);
    setSalasSharedScreensOpen(true);
    setSalaDraftMessage("");
    setSalaActionMenuId(null);
    setSalaPinnedScreenParticipantId(null);
    setSalaMaximizedScreenParticipantId(null);
    setSalaPinnedZoom(1);
    setSalaPinnedPanX(0);
    setSalaPinnedPanY(0);
    setSalaMaxZoom(1);
    setSalaMaxPanX(0);
    setSalaMaxPanY(0);
    setSalaControlRequestPending(false);
    setSalaControlRequestTargetId(null);
    setSalaControlGrantedParticipantId(null);
    setSalaRemotePointerX(50);
    setSalaRemotePointerY(50);
    setSalaRemoteInputDraft("");
    setSalaRemoteLastCommand("");
  };

  const onCreateSala = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }
    const normalizedName = newSalaName.trim();
    if (!normalizedName) {
      return;
    }
    const normalizedCode = normalizeSalaCode(newSalaCode);
    if (!normalizedCode) {
      setSalaFeedback("Ingresa un codigo valido para la sala.", "error");
      return;
    }

    const finalName = normalizedName.toUpperCase().startsWith("SALA ")
      ? normalizedName.toUpperCase()
      : `SALA ${normalizedName.toUpperCase()}`;
    const normalizedDescription = newSalaDescription.trim();
    try {
      const createdRoom = (await postJson("/api/v1/salas", user.token, {
        userId: user.id,
        name: finalName,
        code: normalizedCode,
        visibility: newSalaVisibility,
        description: normalizedDescription || "Nueva sala creada para coordinacion y estudio.",
        imageData: newSalaImageData?.trim() ? newSalaImageData.trim() : null,
      })) as { id?: number };

      await reloadSalas(typeof createdRoom.id === "number" ? createdRoom.id : undefined);

      setNewSalaName("");
      setNewSalaCode("");
      setNewSalaVisibility("public");
      setNewSalaDescription("");
      setNewSalaImageData(null);
      setNewSalaImageName("");
      setShowCreateSalaModal(false);
      setSalaFeedback("Sala creada correctamente.", "success");
    } catch (salaError) {
      if (salaError instanceof Error) {
        setSalaFeedback(salaError.message, "error");
      } else {
        setSalaFeedback("No se pudo crear la sala.", "error");
      }
    }
  };

  const onOpenEditSala = (room: SalaItem) => {
    setEditingSalaId(room.id);
    setEditSalaName(room.name);
    setEditSalaCode(room.code?.trim() ? room.code : buildUniqueSalaCode(salasData));
    setEditSalaVisibility(room.visibility);
    setEditSalaDescription(room.description);
    setEditSalaImageData(room.imageData?.trim() ? room.imageData.trim() : null);
    setEditSalaImageName(room.imageData?.trim() ? "Imagen actual" : "");
    setShowEditSalaModal(true);
    setSalaActionMenuId(null);
  };

  const onSaveSalaEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingSalaId == null || !user) {
      return;
    }
    const normalizedName = editSalaName.trim();
    if (!normalizedName) {
      return;
    }
    const normalizedCode = normalizeSalaCode(editSalaCode);
    if (!normalizedCode) {
      setSalaFeedback("Ingresa un codigo valido para la sala.", "error");
      return;
    }
    const normalizedDescription = editSalaDescription.trim();
    try {
      await patchJson(`/api/v1/salas/${editingSalaId}`, user.token, {
        userId: user.id,
        name: normalizedName.toUpperCase().startsWith("SALA ")
          ? normalizedName.toUpperCase()
          : `SALA ${normalizedName.toUpperCase()}`,
        code: normalizedCode,
        visibility: editSalaVisibility,
        description: normalizedDescription || "Sala actualizada para coordinacion y estudio.",
        imageData: editSalaImageData?.trim() ? editSalaImageData.trim() : null,
      });

      await reloadSalas(editingSalaId);
      setShowEditSalaModal(false);
      setEditingSalaId(null);
      setEditSalaName("");
      setEditSalaCode("");
      setEditSalaVisibility("public");
      setEditSalaDescription("");
      setEditSalaImageData(null);
      setEditSalaImageName("");
      setSalaFeedback("Sala actualizada correctamente.", "success");
    } catch (salaError) {
      if (salaError instanceof Error) {
        setSalaFeedback(salaError.message, "error");
      } else {
        setSalaFeedback("No se pudo actualizar la sala.", "error");
      }
    }
  };

  const onDeleteSala = async () => {
    if (!deleteSalaTarget || !user) {
      return;
    }
    const deleteSalaId = deleteSalaTarget.id;
    try {
      await deleteJson(`/api/v1/salas/${deleteSalaId}?userId=${user.id}`, user.token);
      setDeleteSalaTarget(null);
      setSalaActionMenuId(null);
      setSelectedSalaId((current) => (current === deleteSalaId ? null : current));
      if (selectedSalaId === deleteSalaId) {
        setSalasSharedScreensOpen(true);
        setSalaDraftMessage("");
        setSalaPinnedScreenParticipantId(null);
        setSalaMaximizedScreenParticipantId(null);
        setSalaPinnedZoom(1);
        setSalaPinnedPanX(0);
        setSalaPinnedPanY(0);
        setSalaMaxZoom(1);
        setSalaMaxPanX(0);
        setSalaMaxPanY(0);
        setSalaControlRequestPending(false);
        setSalaControlRequestTargetId(null);
        setSalaControlGrantedParticipantId(null);
        setSalaRemotePointerX(50);
        setSalaRemotePointerY(50);
        setSalaRemoteInputDraft("");
        setSalaRemoteLastCommand("");
      }

      const nextPreferredSalaId = selectedSalaId === deleteSalaId ? undefined : selectedSalaId ?? undefined;
      await reloadSalas(nextPreferredSalaId);
      setSalaFeedback("Sala eliminada.", "success");
    } catch (salaError) {
      if (salaError instanceof Error) {
        setSalaFeedback(salaError.message, "error");
      } else {
        setSalaFeedback("No se pudo eliminar la sala.", "error");
      }
    }
  };

  const onSendSalaMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = salaDraftMessage.trim();
    if (!text || selectedSalaId == null || !user) {
      return;
    }

    try {
      await postJson(`/api/v1/salas/${selectedSalaId}/messages`, user.token, {
        userId: user.id,
        content: text,
      });
      await reloadSalas(selectedSalaId);
      setSalaDraftMessage("");
      setSalasChatOpen(true);
    } catch (salaError) {
      if (salaError instanceof Error) {
        setSalaFeedback(salaError.message, "error");
      } else {
        setSalaFeedback("No se pudo enviar el mensaje.", "error");
      }
    }
  };

  const onToggleMySalaScreenShare = () => {
    if (selectedSalaId == null) {
      return;
    }
    let hasLocalParticipant = false;
    let nextIsSharing = false;

    setSalasData((current) =>
      current.map((sala) => {
        if (sala.id !== selectedSalaId) {
          return sala;
        }

        const myParticipantIndex = sala.participants.findIndex(
          (participant) => participant.name.trim().toLowerCase() === "tu",
        );
        if (myParticipantIndex < 0) {
          return sala;
        }

        hasLocalParticipant = true;
        const updatedParticipants = sala.participants.map((participant, index) =>
          index === myParticipantIndex
            ? {
                ...participant,
                isScreenSharing: !Boolean(participant.isScreenSharing),
              }
            : participant,
        );

        nextIsSharing = Boolean(updatedParticipants[myParticipantIndex]?.isScreenSharing);

        return {
          ...sala,
          participants: updatedParticipants,
        };
      }),
    );

    if (!hasLocalParticipant) {
      setSalaFeedback("No se encontro tu participante local en esta sala.", "error");
      return;
    }

    setSalasSharedScreensOpen(true);
    setSalaFeedback(nextIsSharing ? "Ahora estas compartiendo tu pantalla." : "Dejaste de compartir tu pantalla.", "success");
  };

  const onToggleSalaParticipants = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSalasParticipantsOpen((value) => !value);
  };

  const onToggleSalaChat = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSalasChatOpen((value) => !value);
  };

  const onToggleSalaSharedScreens = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSalasSharedScreensOpen((value) => !value);
  };

  const renderContent = () => {
    if (!user) {
      return null;
    }

    if (loading) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Cargando modulo...
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      );
    }

    if (isAdmin && active === "dashboard") {
      const data = payload as {
        users?: unknown[];
        projects?: unknown[];
        tasks?: unknown[];
      } | null;

      return (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard title="Usuarios" value={String(data?.users?.length ?? 0)} />
          <MetricCard title="Proyectos" value={String(data?.projects?.length ?? 0)} />
          <MetricCard title="Tareas" value={String(data?.tasks?.length ?? 0)} />
        </div>
      );
    }

    if (active === "users") {
      const data = (Array.isArray(payload) ? payload : []) as AdminUserRow[];
      const query = userSearch.trim().toLowerCase();
      const searched = query
        ? data.filter((item) =>
            `${item.name} ${item.username} ${item.email} ${item.firstName ?? ""} ${item.lastName ?? ""}`
              .toLowerCase()
              .includes(query),
          )
        : data;
      const filtered =
        query.length > 0
          ? searched
          : userStatusFilter === "active"
            ? searched.filter((item) => isUserActive(item.status))
            : userStatusFilter === "inactive"
              ? searched.filter((item) => item.status !== 1)
              : searched;
      const perPage = Number.parseInt(userPerPage, 10);
      const pageSize = Number.isNaN(perPage) ? 10 : Math.max(1, perPage);
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const currentPage = Math.min(userPage, totalPages);
      const pageStart = (currentPage - 1) * pageSize;
      const visible = filtered.slice(pageStart, pageStart + pageSize);
      const firstVisibleRow = filtered.length === 0 ? 0 : pageStart + 1;
      const lastVisibleRow = filtered.length === 0 ? 0 : pageStart + visible.length;
      const pageWindowStart = Math.max(1, currentPage - 2);
      const pageWindowEnd = Math.min(totalPages, currentPage + 2);
      const pageNumbers = Array.from(
        { length: pageWindowEnd - pageWindowStart + 1 },
        (_, index) => pageWindowStart + index,
      );

      return (
        <DataCard title="Usuarios">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">Gestion de usuarios del panel admin.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenManageRoles}
                className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Gestionar roles
              </button>
              <button
                type="button"
                    onClick={() => void onDeleteProfileImage()}
                className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
              >
                Nuevo usuario
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={userSearch}
                onChange={(event) => {
                  setUserSearch(event.target.value);
                  setUserPage(1);
                }}
                placeholder="Buscar por nombre, usuario o correo..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400 md:flex-1"
              />
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5">
                <span className="text-sm font-semibold text-slate-600">Mostrar</span>
                <select
                  value={userPerPage}
                  onChange={(event) => {
                    setUserPerPage(event.target.value);
                    setUserPage(1);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5">
                <span className="text-sm font-semibold text-slate-600">Estado</span>
                <select
                  value={userStatusFilter}
                  onChange={(event) => {
                    setUserStatusFilter(event.target.value as "all" | "active" | "inactive");
                    setUserPage(1);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none"
                >
                  <option value="all">Todos</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>
            </div>
          </div>

          {userMessage ? (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                userMessageType === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : userMessageType === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {userMessage}
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className="mt-3">
              <EmptyState text="No hay usuarios para mostrar." />
            </div>
          ) : (
            <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Nombre</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Usuario</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Correo</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Rol</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Estado</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">En linea</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const role = item.roles && item.roles.length > 0 ? item.roles[0] : "user";
                    const isCurrentUser = item.id === user.id;
                    const isOnline = item.online === true;
                    return (
                      <tr key={item.id} className="bg-white text-slate-700">
                        <td className="border-b border-slate-100 px-3 py-2 font-medium">{item.name}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{item.username}</td>
                        <td className="border-b border-slate-100 px-3 py-2">{item.email}</td>
                        <td className="border-b border-slate-100 px-3 py-2 uppercase">{role}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isUserActive(item.status)
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700"
                            }`}
                          >
                            {isUserActive(item.status) ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                            }`}
                            title={item.lastSeenAt ? `Ultima actividad: ${item.lastSeenAt}` : "Sin actividad registrada"}
                          >
                            {isOnline ? "En linea" : "Fuera de linea"}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenEditUser(item)}
                              className="rounded-lg border border-blue-300 p-2 text-blue-700 hover:bg-blue-50"
                              aria-label="Editar usuario"
                              title="Editar usuario"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="h-4 w-4"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5Z"
                                />
                              </svg>
                            </button>

                            <button
                              onClick={() => void onToggleUserStatus(item)}
                              disabled={isCurrentUser}
                              className={`rounded-lg border p-2 ${
                                isCurrentUser
                                  ? "cursor-not-allowed border-slate-200 text-slate-400"
                                  : isUserActive(item.status)
                                    ? "border-rose-300 text-rose-600 hover:bg-rose-50"
                                    : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              }`}
                              aria-label={isUserActive(item.status) ? "Inactivar usuario" : "Activar usuario"}
                              title={isCurrentUser ? "No disponible para tu cuenta" : isUserActive(item.status) ? "Inactivar usuario" : "Activar usuario"}
                            >
                              {isUserActive(item.status) ? (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-4 w-4"
                                >
                                  <circle cx="12" cy="12" r="9" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8" />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-4 w-4"
                                >
                                  <circle cx="12" cy="12" r="9" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm text-slate-600">
                Mostrando {firstVisibleRow} - {lastVisibleRow} de {filtered.length}
              </p>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setUserPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>

                {pageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setUserPage(pageNumber)}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      pageNumber === currentPage
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setUserPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          ) : null}

          {showCreateUserPanel ? (
            <ModalShell
              title="Nuevo usuario"
              onClose={() => {
                setShowCreateUserPanel(false);
              }}
            >
              <form onSubmit={onCreateUser} className="grid gap-2 md:grid-cols-2">
                <input
                  value={newUserFirstName}
                  onChange={(event) => setNewUserFirstName(event.target.value)}
                  placeholder="Nombres"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  value={newUserLastName}
                  onChange={(event) => setNewUserLastName(event.target.value)}
                  placeholder="Apellidos"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  value={newUserUsername}
                  onChange={(event) => setNewUserUsername(event.target.value)}
                  placeholder="Username"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(event) => setNewUserEmail(event.target.value)}
                  placeholder="Correo"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(event) => setNewUserPassword(event.target.value)}
                  placeholder="Password"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <select
                  value={newUserRole}
                  onChange={(event) => setNewUserRole(event.target.value as "user" | "admin")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>

                <div className="md:col-span-2 mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateUserPanel(false)}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    {creatingUser ? "Creando..." : "Crear usuario"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showManageRolesPanel ? (
            <ModalShell
              title="Gestionar roles"
              onClose={() => {
                setShowManageRolesPanel(false);
              }}
            >
              <div className="space-y-3">
                <form onSubmit={onCreateRole} className="flex flex-wrap items-center gap-2">
                  <input
                    value={newRoleName}
                    onChange={(event) => setNewRoleName(event.target.value)}
                    placeholder="Nombre del rol"
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                  <button
                    type="submit"
                    disabled={creatingRole}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    {creatingRole ? "Creando..." : "Crear rol"}
                  </button>
                </form>

                {rolesLoading ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Cargando roles...
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                    <div className="max-h-[50vh] space-y-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                      {rolesData.length === 0 ? (
                        <p className="px-2 py-2 text-sm text-slate-500">Sin roles registrados.</p>
                      ) : (
                        rolesData.map((role) => (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => onSelectRole(role.id)}
                            className={`block w-full rounded-md px-3 py-2 text-left text-sm font-medium ${
                              selectedRoleId === role.id
                                ? "bg-blue-600 text-white"
                                : "text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {role.name}
                          </button>
                        ))
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="mb-2 text-sm font-semibold text-slate-800">Permisos del rol seleccionado</p>
                      {selectedRoleId == null ? (
                        <p className="text-sm text-slate-500">Selecciona un rol para editar permisos.</p>
                      ) : (
                        <>
                          <div className="max-h-[38vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                            <div className="grid gap-2 md:grid-cols-2">
                              {availablePermissions.map((permission) => (
                                <label
                                  key={permission}
                                  className="flex items-center gap-2 rounded-md bg-white px-2 py-1 text-sm text-slate-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedRolePermissions.includes(permission)}
                                    onChange={() => onToggleRolePermission(permission)}
                                  />
                                  <span>{permission}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void onSaveRolePermissions()}
                              disabled={rolesSaving}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                            >
                              {rolesSaving ? "Guardando..." : "Guardar permisos"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ModalShell>
          ) : null}

          {showEditUserPanel ? (
            <ModalShell
              title="Editar usuario"
              onClose={() => {
                setShowEditUserPanel(false);
                resetEditUserForm();
              }}
            >
              <form onSubmit={onUpdateUser} className="grid gap-2 md:grid-cols-2">
                <input
                  value={editUserFirstName}
                  onChange={(event) => setEditUserFirstName(event.target.value)}
                  placeholder="Nombres"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  value={editUserLastName}
                  onChange={(event) => setEditUserLastName(event.target.value)}
                  placeholder="Apellidos"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  value={editUserUsername}
                  onChange={(event) => setEditUserUsername(event.target.value)}
                  placeholder="Username"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  type="email"
                  value={editUserEmail}
                  onChange={(event) => setEditUserEmail(event.target.value)}
                  placeholder="Correo"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <input
                  type="password"
                  value={editUserPassword}
                  onChange={(event) => setEditUserPassword(event.target.value)}
                  placeholder="Nueva password (opcional)"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />
                <select
                  value={editUserRole}
                  onChange={(event) => setEditUserRole(event.target.value as "user" | "admin")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>

                <div className="md:col-span-2 mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditUserPanel(false);
                      resetEditUserForm();
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={updatingUser}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    {updatingUser ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}
        </DataCard>
      );
    }

    if (active === "projects") {
      const data = (payload as Array<{ id: number; name: string; status: string }>) ?? [];
      return (
        <DataCard title="Proyectos">
          {data.length === 0 ? (
            <EmptyState text="No hay proyectos para mostrar." />
          ) : (
            <ul className="space-y-2">
              {data.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">{item.name}</span> | {item.status}
                </li>
              ))}
            </ul>
          )}
        </DataCard>
      );
    }

    if (active === "tasks") {
      const data = (payload as Array<{ id: number; title: string; status: string }>) ?? [];
      return (
        <DataCard title="Tareas">
          {data.length === 0 ? (
            <EmptyState text="No hay tareas para mostrar." />
          ) : (
            <ul className="space-y-2">
              {data.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">{item.title}</span> | {item.status}
                </li>
              ))}
            </ul>
          )}
        </DataCard>
      );
    }

    if (active === "inicio") {
      return (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="grid gap-4 md:grid-cols-2 xl:col-span-2">
            <DataCard title="Panel de bienvenida">
              <p className="text-sm text-slate-700">
                Bienvenido {user.name}. Desde aqui puedes acceder a IA, examenes, salas y horarios.
              </p>
            </DataCard>
            <DataCard title="Accesos rapidos">
              <div className="grid grid-cols-2 gap-2">
                {["IA", "Examenes", "Salas", "Horarios"].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setActive(item.toLowerCase())}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </DataCard>
          </div>
          <DataCard title={`Notificaciones${unreadNotificationsCount > 0 ? ` (${unreadNotificationsCount} nuevas)` : ""}`}>
            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                Aqui llegan tus invitaciones. Puedes aceptarlas sin salir de Inicio.
              </p>
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {homeShareNotificationsLoading ? (
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    Cargando notificaciones...
                  </article>
                ) : homeShareNotifications.length === 0 ? (
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    No tienes invitaciones por ahora.
                  </article>
                ) : (
                  homeShareNotifications.map((notification) => {
                    const resourceTypeText =
                      notification.resourceType === "exam"
                        ? "Examen"
                        : notification.resourceType === "course"
                          ? "Curso"
                          : notification.resourceType === "schedule"
                            ? "Horario"
                          : notification.resourceType === "sala"
                            ? "Sala"
                            : "Recurso";
                    const invitationStatus = normalizeInvitationStatus(notification.invitationStatus);
                    const requiresInvitationResponse = notificationRequiresInvitationResponse(notification.resourceType);
                    const isPendingInvite = requiresInvitationResponse && invitationStatus === "pending";
                    const isRejectedInvite = requiresInvitationResponse && invitationStatus === "rejected";
                    const shareUrl =
                      notification.token && notification.token.trim()
                        ? buildShareAccessUrl(notification.token.trim())
                        : "";
                    const isRead = !!notification.readAt;
                    const canOpenResource = requiresInvitationResponse ? invitationStatus === "accepted" : !!shareUrl;
                    return (
                      <article
                        key={notification.id}
                        className={`rounded-xl border p-3 ${
                          isRead ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"
                        }`}
                      >
                        <p className="text-sm font-semibold text-slate-800">
                          {resourceTypeText}: {notification.resourceName?.trim() || "Sin nombre"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {notification.message?.trim() || "Recibiste una invitacion compartida."}
                        </p>
                        {isRejectedInvite ? (
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                            Invitacion rechazada
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          {isPendingInvite ? (
                            <>
                              <button
                                type="button"
                                disabled={notificationActionLoadingId === notification.id}
                                onClick={() => void onRejectNotificationInvitation(notification)}
                                className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {notificationActionLoadingId === notification.id ? "Procesando..." : "Rechazar"}
                              </button>
                              <button
                                type="button"
                                disabled={notificationActionLoadingId === notification.id}
                                onClick={() => void onAcceptNotificationInvitation(notification)}
                                className="rounded-lg bg-[#004aad] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#003b88] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {notificationActionLoadingId === notification.id ? "Aceptando..." : "Aceptar"}
                              </button>
                            </>
                          ) : canOpenResource ? (
                            <button
                              type="button"
                              onClick={() => void onOpenNotificationResource(notification)}
                              className="rounded-lg bg-[#004aad] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#003b88]"
                            >
                              {notification.resourceType === "exam" ? "Ver examen" : notification.resourceType === "schedule" ? "Ver horario" : "Abrir"}
                            </button>
                          ) : null}
                          {!isRead ? (
                            <button
                              type="button"
                              disabled={notificationActionLoadingId === notification.id}
                              onClick={() => void onMarkNotificationAsRead(notification)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {notificationActionLoadingId === notification.id ? "Marcando..." : "Marcar leida"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setActive("notificaciones")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Ver bandeja completa
                </button>
              </div>
            </div>
          </DataCard>
        </div>
      );
    }

    if (active === "cursos") {
      const data = parseCourseModulePayload(payload);
      const courses = data.courses;
      const availableExams = data.availableExams;
      const years = Array.from(
        new Set(
          courses
            .map((course) => {
              const rawDate = course.createdAt;
              if (!rawDate) {
                return null;
              }
              const date = new Date(String(rawDate));
              if (Number.isNaN(date.getTime())) {
                return null;
              }
              return date.getFullYear();
            })
            .filter((year): year is number => year != null),
        ),
      ).sort((first, second) => second - first);
      const normalizedSearchQuery = courseSearchQuery.trim().toLowerCase();
      const resolveCourseVisibility = (course: CourseItem): "public" | "private" =>
        course.visibility === "private" ? "private" : "public";
      const resolveCoursePriority = (course: CourseItem): "very_important" | "important" | "low_important" | "optional" => {
        if (course.priority === "very_important" || course.priority === "low_important" || course.priority === "optional") {
          return course.priority;
        }
        return "important";
      };
      const resolveCourseSortOrder = (course: CourseItem): number => {
        const raw = Number(course.sortOrder ?? 0);
        if (!Number.isFinite(raw) || raw < 0) {
          return 0;
        }
        return Math.trunc(raw);
      };
      const coursePriorityWeight = (
        priority: "very_important" | "important" | "low_important" | "optional",
      ): number => {
        if (priority === "very_important") {
          return 0;
        }
        if (priority === "important") {
          return 1;
        }
        if (priority === "low_important") {
          return 2;
        }
        return 3;
      };
      const coursePriorityLabel = (
        priority: "very_important" | "important" | "low_important" | "optional",
      ): string => {
        if (priority === "very_important") {
          return "Muy importante";
        }
        if (priority === "important") {
          return "Importante";
        }
        if (priority === "low_important") {
          return "Poco importante";
        }
        return "Opcional";
      };
      const resolveCourseOwner = (course: CourseItem): boolean =>
        user == null ? true : course.ownerUserId == null || course.ownerUserId === user.id;
      const courseScopeCounts = courses.reduce(
        (acc, course) => {
          const visibility = resolveCourseVisibility(course);
          const isOwner = resolveCourseOwner(course);
          acc.all += 1;
          if (isOwner) {
            acc.mine += 1;
          }
          if (!isOwner && visibility === "private") {
            acc.shared += 1;
          }
          if (visibility === "public") {
            acc.public += 1;
          }
          if (visibility === "private") {
            acc.private += 1;
          }
          return acc;
        },
        { all: 0, mine: 0, shared: 0, public: 0, private: 0 },
      );
      const filteredCourses = [...courses]
        .filter((course) => {
          const visibility = resolveCourseVisibility(course);
          const isOwner = resolveCourseOwner(course);
          if (courseScopeFilter === "mine") {
            return isOwner;
          }
          if (courseScopeFilter === "shared") {
            return !isOwner && visibility === "private";
          }
          if (courseScopeFilter === "public") {
            return visibility === "public";
          }
          if (courseScopeFilter === "private") {
            return visibility === "private";
          }
          return true;
        })
        .filter((course) => {
          if (courseYearFilter === "all") {
            return true;
          }
          if (!course.createdAt) {
            return false;
          }
          const date = new Date(String(course.createdAt));
          if (Number.isNaN(date.getTime())) {
            return false;
          }
          return String(date.getFullYear()) === courseYearFilter;
        })
        .filter((course) => {
          if (courseProgressFilter === "all") {
            return true;
          }
          if (courseProgressFilter === "with_exams") {
            return countCourseExams(course) > 0;
          }
          if (courseProgressFilter === "without_exams") {
            return countCourseExams(course) === 0;
          }
          return true;
        })
        .filter((course) => {
          if (!normalizedSearchQuery) {
            return true;
          }
          return `${course.name} ${course.description ?? ""} ${course.code ?? ""}`
            .toLowerCase()
            .includes(normalizedSearchQuery);
        })
        .sort((first, second) => {
          const firstPriorityWeight = coursePriorityWeight(resolveCoursePriority(first));
          const secondPriorityWeight = coursePriorityWeight(resolveCoursePriority(second));
          if (firstPriorityWeight !== secondPriorityWeight) {
            return firstPriorityWeight - secondPriorityWeight;
          }
          const firstCustomOrder = resolveCourseSortOrder(first);
          const secondCustomOrder = resolveCourseSortOrder(second);
          if (firstCustomOrder !== secondCustomOrder) {
            return firstCustomOrder - secondCustomOrder;
          }
          if (courseSortMode === "name_desc") {
            return second.name.localeCompare(first.name, "es", { sensitivity: "base" });
          }
          if (courseSortMode === "newest" || courseSortMode === "oldest") {
            const firstDate = first.createdAt ? new Date(String(first.createdAt)).getTime() : 0;
            const secondDate = second.createdAt ? new Date(String(second.createdAt)).getTime() : 0;
            return courseSortMode === "newest" ? secondDate - firstDate : firstDate - secondDate;
          }
          return first.name.localeCompare(second.name, "es", { sensitivity: "base" });
        });
      const coverStyles = [
        "bg-[radial-gradient(circle_at_20%_20%,#e2e8f0_0%,#e2e8f0_18%,transparent_18%),radial-gradient(circle_at_80%_30%,#cbd5e1_0%,#cbd5e1_14%,transparent_14%),radial-gradient(circle_at_40%_70%,#dbeafe_0%,#dbeafe_16%,transparent_16%),#f1f5f9]",
        "bg-[radial-gradient(circle_at_15%_25%,#2563eb_0%,#2563eb_20%,transparent_20%),radial-gradient(circle_at_75%_30%,#3b82f6_0%,#3b82f6_18%,transparent_18%),radial-gradient(circle_at_45%_75%,#1d4ed8_0%,#1d4ed8_20%,transparent_20%),#bfdbfe]",
        "bg-[radial-gradient(circle_at_20%_20%,#93c5fd_0%,#93c5fd_22%,transparent_22%),radial-gradient(circle_at_75%_35%,#60a5fa_0%,#60a5fa_18%,transparent_18%),radial-gradient(circle_at_45%_75%,#3b82f6_0%,#3b82f6_18%,transparent_18%),#dbeafe]",
      ];
      const managingCourse =
        managingCourseId == null ? null : courses.find((course) => course.id === managingCourseId) ?? null;
      const openedCourse =
        openedCourseId == null ? null : courses.find((course) => course.id === openedCourseId) ?? null;
      const openedCourseCode =
        openedCourse?.code?.trim() ? openedCourse.code.trim() : openedCourse != null ? `CURSO-${openedCourse.id}` : "";
      const openedCourseVisibility = openedCourse?.visibility === "private" ? "private" : "public";
      const openedCoursePriority = openedCourse ? resolveCoursePriority(openedCourse) : "important";
      const openedCourseSortOrder = openedCourse ? resolveCourseSortOrder(openedCourse) : 0;
      const openedCourseIsOwner =
        openedCourse != null && user != null
          ? openedCourse.ownerUserId == null || openedCourse.ownerUserId === user.id
          : false;
      const openedCourseSessions = openedCourse?.sessions ?? [];
      const openedCourseParticipants = openedCourse?.participants ?? [];
      const openedCourseGrades = openedCourse?.grades ?? [];
      const openedCourseCompetencies = [...(openedCourse?.competencies ?? [])].sort((first, second) => {
        const firstOrder = Number(first.sortOrder ?? 0);
        const secondOrder = Number(second.sortOrder ?? 0);
        if (firstOrder !== secondOrder) {
          return firstOrder - secondOrder;
        }
        return first.name.localeCompare(second.name, "es", { sensitivity: "base" });
      });
      const formatGradePercent = (value?: number | null) => {
        if (typeof value !== "number" || Number.isNaN(value)) {
          return "N/D";
        }
        return `${value.toFixed(2)}%`;
      };
      const orderedOpenedCourseSessions = [...openedCourseSessions].sort((first, second) => {
        const firstOrder = parseSessionOrderFromName(first.name);
        const secondOrder = parseSessionOrderFromName(second.name);

        if (firstOrder != null && secondOrder != null && firstOrder !== secondOrder) {
          return firstOrder - secondOrder;
        }
        if (firstOrder != null && secondOrder == null) {
          return -1;
        }
        if (firstOrder == null && secondOrder != null) {
          return 1;
        }

        const firstDate = first.createdAt ? new Date(String(first.createdAt)).getTime() : 0;
        const secondDate = second.createdAt ? new Date(String(second.createdAt)).getTime() : 0;
        return firstDate - secondDate;
      });
      const nextOpenedSessionOrder = getNextSessionOrder(openedCourseSessions);
      return (
        <div className="w-full space-y-4">
          <DataCard title="Cursos">
            {!openedCourse ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {[
                  { key: "mine", label: "Mis cursos", count: courseScopeCounts.mine },
                  { key: "shared", label: "Compartidos", count: courseScopeCounts.shared },
                  { key: "public", label: "Publicos", count: courseScopeCounts.public },
                  { key: "private", label: "Privados", count: courseScopeCounts.private },
                ].map((scope) => (
                  <button
                    key={scope.key}
                    type="button"
                    onClick={() =>
                      setCourseScopeFilter(scope.key as "all" | "mine" | "shared" | "public" | "private")
                    }
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      courseScopeFilter === scope.key
                        ? "border-[#004aad] bg-[#004aad] text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {scope.label} <span className="ml-1 text-xs opacity-90">{scope.count}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCourseScopeFilter("all")}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    courseScopeFilter === "all"
                      ? "border-[#004aad] bg-[#004aad] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Todos <span className="ml-1 text-xs opacity-90">{courseScopeCounts.all}</span>
                </button>
              </div>
              <div className="flex flex-wrap items-stretch gap-2">
              <select
                value={courseYearFilter}
                onChange={(event) => setCourseYearFilter(event.target.value)}
                className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 outline-none focus:border-blue-500 sm:w-auto"
              >
                <option value="all">Ano</option>
                {years.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
              <select
                value={courseProgressFilter}
                onChange={(event) => setCourseProgressFilter(event.target.value)}
                className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 outline-none focus:border-blue-500 sm:w-auto"
              >
                <option value="all">Progreso</option>
                <option value="with_exams">Con examenes</option>
                <option value="without_exams">Sin examenes</option>
              </select>
              <div className="flex w-full min-w-0 flex-1 items-center rounded-lg border border-blue-300 bg-white sm:min-w-[240px]">
                <input
                  value={courseSearchQuery}
                  onChange={(event) => setCourseSearchQuery(event.target.value)}
                  placeholder="Buscar (nombre o codigo)"
                  className="w-full bg-transparent px-3 py-2 text-sm text-slate-900 outline-none"
                />
                {courseSearchQuery.trim() ? (
                  <button
                    type="button"
                    onClick={() => setCourseSearchQuery("")}
                    className="px-2 text-slate-500 hover:text-slate-700"
                  >
                    x
                  </button>
                ) : null}
              </div>

              <select
                value={courseSortMode}
                onChange={(event) =>
                  setCourseSortMode(event.target.value as "name_asc" | "name_desc" | "newest" | "oldest")
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 sm:w-auto"
              >
                <option value="name_asc">Ordenar por nombre del curso</option>
                <option value="name_desc">Nombre (Z-A)</option>
                <option value="newest">Mas recientes</option>
                <option value="oldest">Mas antiguos</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setCourseName("");
                  setCourseDescription("");
                  setCourseCode("");
                  setCourseVisibility("public");
                  setCourseCoverImageData(null);
                  setCourseCoverImageName("");
                  setShowCreateCourseModal(true);
                }}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 sm:w-auto"
              >
                Crear curso
              </button>
            </div>
            </div>
            ) : null}

            {courseMessage ? (
              <p
                className={`mt-3 text-sm ${
                  courseMessageType === "error"
                      ? "text-rose-700"
                      : "text-blue-700"
                }`}
              >
                {courseMessage}
              </p>
            ) : null}

            <div className="mt-4 space-y-3">
              {openedCourse ? (
                <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenedCourseId(null);
                        setOpenedCourseTab("curso");
                        setExpandedSessionId(null);
                        setShowCreateCourseSessionModal(false);
                        setShowEditCourseSessionModal(false);
                        setEditingCourseSessionId(null);
                        setEditingCourseSessionName("");
                        setEditingCourseSessionWeeklyContent("");
                        setCourseSessionName("");
                        setCourseSessionWeeklyContent("");
                        setCourseParticipantIdentifier("");
                        setCourseParticipantRole("viewer");
                        resetCourseCompetencyEditor();
                        resetSessionContentEditor();
                      }}
                      className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                    >
                      Volver a cursos
                    </button>
                  </div>

                  <article className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xl font-semibold text-[#004aad]">{openedCourse.name}</p>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {[
                        { key: "curso", label: "Curso" },
                        { key: "participantes", label: "Participantes" },
                        { key: "calificaciones", label: "Calificaciones" },
                        { key: "competencias", label: "Competencias" },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() =>
                            setOpenedCourseTab(
                              tab.key as "curso" | "participantes" | "calificaciones" | "competencias",
                            )
                          }
                          className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            openedCourseTab === tab.key
                              ? "border-[#004aad] bg-[#004aad] text-white"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </article>

                  {openedCourseTab === "curso" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <article className="rounded-xl border border-slate-200 bg-white p-4">
                          <p className="text-sm font-semibold text-slate-800">Informacion del curso</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              Codigo: {openedCourseCode}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                openedCourseVisibility === "public"
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {openedCourseVisibility === "public" ? "Publico" : "Privado"}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                              Prioridad: {coursePriorityLabel(openedCoursePriority)}
                            </span>
                            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                              Orden: {openedCourseSortOrder}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">
                            {openedCourse.description?.trim() || "Sin descripcion del curso."}
                          </p>
                        </article>
                        <article className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800">Sesiones del curso</p>
                            {openedCourseIsOwner ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setCourseSessionName(`SESION ${nextOpenedSessionOrder}: `);
                                  setCourseSessionWeeklyContent("");
                                  setShowCreateCourseSessionModal(true);
                                }}
                                className="rounded-lg bg-[#004aad] px-3 py-2 text-xs font-semibold text-white hover:bg-[#003b88]"
                              >
                                Crear sesion
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            Total de sesiones: <span className="font-semibold text-slate-800">{openedCourseSessions.length}</span>
                          </p>
                        </article>
                      </div>

                      <article className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-800">Listado de sesiones</p>
                        {openedCourseSessions.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-600">
                            Aun no hay sesiones. Crea la primera sesion para empezar el contenido semanal.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {orderedOpenedCourseSessions.map((session) => (
                              <article key={session.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[#004aad]">{formatSessionName(session.name)}</p>
                                  <div className="flex items-center gap-1">
                                    {openedCourseIsOwner ? (
                                      <button
                                        type="button"
                                        onClick={() => onOpenEditCourseSession(session)}
                                        title="Editar sesion"
                                        aria-label="Editar sesion"
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          className="h-3.5 w-3.5"
                                        >
                                          <path strokeLinecap="round" strokeLinejoin="round" d="m3 21 3.8-1 11.4-11.4a2.1 2.1 0 0 0-3-3L3.8 17 3 21z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6.5 3 3" />
                                        </svg>
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => onOpenSessionContent(session)}
                                      className="rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                    >
                                      {expandedSessionId === session.id ? "Ocultar contenido" : "Abrir contenido"}
                                    </button>
                                  </div>
                                </div>
                                {expandedSessionId === session.id ? (
                                  <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <p className="text-xs text-slate-600">
                                      {session.weeklyContent?.trim() || "Sin descripcion registrada en esta sesion."}
                                    </p>

                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Contenidos guardados</p>
                                      {session.contents && session.contents.length > 0 ? (
                                        <div className="space-y-2">
                                          {session.contents.map((content) => {
                                            const contentType = (content.type ?? "").toLowerCase();
                                            const typeLabel =
                                              contentType === "video"
                                                ? "Video"
                                                : contentType === "pdf"
                                                  ? "PDF"
                                                  : contentType === "word"
                                                    ? "Word"
                                                    : contentType === "exam"
                                                      ? "Examen"
                                                    : contentType === "cover"
                                                      ? "Portada"
                                                      : "Contenido";
                                            return (
                                              <div
                                                key={content.id}
                                                className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                                              >
                                                <div className="min-w-0">
                                                  <p className="font-semibold text-slate-800">
                                                    {content.title?.trim() || "Sin nombre"} - {typeLabel}
                                                  </p>
                                                  {content.externalLink?.trim() ? (
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                                      <button
                                                        type="button"
                                                        onClick={() => onOpenCourseContentPreview(content)}
                                                        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                                      >
                                                        Ver
                                                      </button>
                                                      <a
                                                        href={content.externalLink}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                                      >
                                                        Abrir enlace
                                                      </a>
                                                    </div>
                                                  ) : null}
                                                  {content.fileName?.trim() ? (
                                                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                                      <p className="max-w-[280px] truncate text-slate-600">{content.fileName}</p>
                                                      {content.fileData?.trim() ? (
                                                        <>
                                                          <button
                                                            type="button"
                                                            onClick={() => onOpenCourseContentPreview(content)}
                                                            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                                          >
                                                            Ver
                                                          </button>
                                                          <a
                                                            href={content.fileData}
                                                            download={content.fileName}
                                                            className="rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                                          >
                                                            Descargar
                                                          </a>
                                                        </>
                                                      ) : null}
                                                    </div>
                                                  ) : null}
                                                  {contentType === "exam" ? (
                                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                                      <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                                        {content.sourceExamName?.trim() || "Examen asociado"}
                                                      </span>
                                                      <button
                                                        type="button"
                                                        onClick={() => void onStartPracticeFromCourseSessionContent(session.id, content)}
                                                        className="rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                                      >
                                                        Iniciar repaso
                                                      </button>
                                                    </div>
                                                  ) : null}
                                                </div>
                                                {openedCourseIsOwner ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => onOpenEditSessionContentModal(session, content)}
                                                    title="Editar contenido"
                                                    aria-label="Editar contenido"
                                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                                  >
                                                    <svg
                                                      xmlns="http://www.w3.org/2000/svg"
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      strokeWidth="2"
                                                      className="h-3.5 w-3.5"
                                                    >
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="m3 21 3.8-1 11.4-11.4a2.1 2.1 0 0 0-3-3L3.8 17 3 21z" />
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.5 6.5 3 3" />
                                                    </svg>
                                                  </button>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-slate-500">No hay contenidos guardados aun.</p>
                                      )}
                                    </div>

                                    {openedCourseIsOwner ? (
                                      <div className="flex justify-end">
                                        <button
                                          type="button"
                                          onClick={() => onOpenAddSessionContentModal(session)}
                                          className="rounded-lg bg-[#004aad] px-3 py-2 text-xs font-semibold text-white hover:bg-[#003b88]"
                                        >
                                          Anadir contenido
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        )}
                      </article>

                    </div>
                  ) : null}

                  {openedCourseTab === "participantes" ? (
                    <article className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-800">Participantes del curso</p>
                      {openedCourseIsOwner ? (
                        <form onSubmit={onAddCourseParticipant} className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                          <input
                            value={courseParticipantIdentifier}
                            onChange={(event) => setCourseParticipantIdentifier(event.target.value)}
                            placeholder="Correo o username del participante"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          />
                          <select
                            value={courseParticipantRole}
                            onChange={(event) =>
                              setCourseParticipantRole(event.target.value as "viewer" | "editor" | "assistant")
                            }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            <option value="assistant">Assistant</option>
                          </select>
                          <button
                            type="submit"
                            disabled={addingCourseParticipant}
                            className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                          >
                            {addingCourseParticipant ? "Agregando..." : "Agregar"}
                          </button>
                        </form>
                      ) : null}

                      <div className="mt-3 space-y-2">
                        {openedCourseParticipants.length === 0 ? (
                          <p className="text-sm text-slate-600">No hay participantes registrados.</p>
                        ) : (
                          openedCourseParticipants.map((participant) => {
                            const participantRole = (participant.role ?? "viewer").toLowerCase();
                            const isOwner = participant.owner === true || participantRole === "owner";
                            const canManage = openedCourseIsOwner && !isOwner;
                            const isSaving = savingCourseParticipantUserId === participant.userId;
                            return (
                              <div
                                key={participant.userId}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-900">{participant.name}</p>
                                    <p className="text-xs text-slate-600">
                                      @{participant.username} - {participant.email}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                        {isOwner
                                          ? "Creador"
                                          : participantRole === "editor"
                                            ? "Editor"
                                            : participantRole === "assistant"
                                              ? "Assistant"
                                              : "Viewer"}
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        Unido: {formatExamCreatedAt(participant.joinedAt)}
                                      </span>
                                    </div>
                                  </div>
                                  {canManage ? (
                                    <div className="flex flex-wrap items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void onUpdateCourseParticipantRole(participant.userId, "viewer")}
                                        disabled={isSaving}
                                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
                                      >
                                        Viewer
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void onUpdateCourseParticipantRole(participant.userId, "editor")}
                                        disabled={isSaving}
                                        className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-70"
                                      >
                                        Editor
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void onUpdateCourseParticipantRole(participant.userId, "assistant")}
                                        disabled={isSaving}
                                        className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-70"
                                      >
                                        Assistant
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void onRemoveCourseParticipant(participant.userId)}
                                        disabled={isSaving}
                                        className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                                      >
                                        {isSaving ? "..." : "Quitar"}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </article>
                  ) : null}

                  {openedCourseTab === "calificaciones" ? (
                    <article className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-800">Calificaciones</p>
                      {openedCourseGrades.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-600">Aun no hay intentos registrados para este curso.</p>
                      ) : (
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                                <th className="px-2 py-2">Participante</th>
                                <th className="px-2 py-2">Intentos</th>
                                <th className="px-2 py-2">Promedio</th>
                                <th className="px-2 py-2">Mejor</th>
                                <th className="px-2 py-2">Ultimo</th>
                                <th className="px-2 py-2">Ultimo intento</th>
                              </tr>
                            </thead>
                            <tbody>
                              {openedCourseGrades.map((grade) => (
                                <tr key={grade.userId} className="border-b border-slate-100 text-slate-700">
                                  <td className="px-2 py-2">
                                    <p className="font-semibold text-slate-900">{grade.name}</p>
                                    <p className="text-xs text-slate-500">@{grade.username}</p>
                                  </td>
                                  <td className="px-2 py-2">{grade.attemptsCount ?? 0}</td>
                                  <td className="px-2 py-2">{formatGradePercent(grade.averageScore)}</td>
                                  <td className="px-2 py-2">{formatGradePercent(grade.bestScore)}</td>
                                  <td className="px-2 py-2">{formatGradePercent(grade.lastScore)}</td>
                                  <td className="px-2 py-2">{formatExamCreatedAt(grade.lastAttemptAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </article>
                  ) : null}

                  {openedCourseTab === "competencias" ? (
                    <article className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-800">Competencias</p>
                      {openedCourseIsOwner ? (
                        <form onSubmit={onSaveCourseCompetency} className="mt-3 grid gap-2 md:grid-cols-2">
                          <input
                            value={courseCompetencyName}
                            onChange={(event) => setCourseCompetencyName(event.target.value)}
                            placeholder="Nombre de la competencia"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          />
                          <select
                            value={courseCompetencyLevel}
                            onChange={(event) =>
                              setCourseCompetencyLevel(event.target.value as "basico" | "intermedio" | "avanzado")
                            }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          >
                            <option value="basico">Basico</option>
                            <option value="intermedio">Intermedio</option>
                            <option value="avanzado">Avanzado</option>
                          </select>
                          <input
                            value={courseCompetencySortOrder}
                            onChange={(event) => setCourseCompetencySortOrder(event.target.value)}
                            placeholder="Orden"
                            inputMode="numeric"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          />
                          <textarea
                            value={courseCompetencyDescription}
                            onChange={(event) => setCourseCompetencyDescription(event.target.value)}
                            placeholder="Descripcion (opcional)"
                            rows={3}
                            className="resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          />
                          <div className="md:col-span-2 flex justify-end gap-2">
                            {editingCourseCompetencyId != null ? (
                              <button
                                type="button"
                                onClick={resetCourseCompetencyEditor}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Cancelar edicion
                              </button>
                            ) : null}
                            <button
                              type="submit"
                              disabled={savingCourseCompetency}
                              className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                            >
                              {savingCourseCompetency
                                ? "Guardando..."
                                : editingCourseCompetencyId == null
                                  ? "Agregar competencia"
                                  : "Guardar cambios"}
                            </button>
                          </div>
                        </form>
                      ) : null}

                      <div className="mt-3 space-y-2">
                        {openedCourseCompetencies.length === 0 ? (
                          <p className="text-sm text-slate-600">No hay competencias registradas.</p>
                        ) : (
                          openedCourseCompetencies.map((competency) => (
                            <div
                              key={competency.id}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-900">{competency.name}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                                      {(competency.level ?? "basico").toUpperCase()}
                                    </span>
                                    <span>Orden: {Math.max(0, Number(competency.sortOrder ?? 0) || 0)}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-600">
                                    {competency.description?.trim() || "Sin descripcion"}
                                  </p>
                                </div>
                                {openedCourseIsOwner ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onEditCourseCompetency(competency)}
                                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                    >
                                      Editar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void onDeleteCourseCompetency(competency.id)}
                                      disabled={deletingCourseCompetencyId === competency.id}
                                      className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                                    >
                                      {deletingCourseCompetencyId === competency.id ? "..." : "Eliminar"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  ) : null}
                </section>
              ) : filteredCourses.length === 0 ? (
                <EmptyState text="No hay cursos para mostrar con esos filtros." />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {filteredCourses.map((course, index) => (
                    <article key={course.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      {(() => {
                        const isOwnerCourse =
                          user == null ? true : course.ownerUserId == null || course.ownerUserId === user.id;
                        const courseCode = course.code?.trim() ? course.code.trim() : `CURSO-${course.id}`;
                        const courseVisibility = course.visibility === "private" ? "private" : "public";
                        const coursePriority = resolveCoursePriority(course);
                        const courseCustomOrder = resolveCourseSortOrder(course);
                        return (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                        <div className="h-40 w-full shrink-0 overflow-hidden rounded-xl border border-slate-200 sm:h-28 sm:w-44">
                          {course.coverImageData?.trim() ? (
                            <img
                              src={course.coverImageData}
                              alt={`Imagen del curso ${course.name}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className={`h-full w-full ${coverStyles[index % coverStyles.length]}`} />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenedCourseId(course.id);
                              setOpenedCourseTab("curso");
                              setCourseActionMenuId(null);
                              setCourseParticipantIdentifier("");
                              setCourseParticipantRole("viewer");
                              resetCourseCompetencyEditor();
                            }}
                            className="text-left text-lg font-semibold text-[#004aad] hover:underline sm:text-xl"
                          >
                            {course.name}
                          </button>
                          <p className="mt-1 text-sm text-slate-900 sm:text-base">
                            {course.description?.trim() || "Sin descripcion del curso."}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              Codigo: {courseCode}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                courseVisibility === "public"
                                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {courseVisibility === "public" ? "Publico" : "Privado"}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                              {coursePriorityLabel(coursePriority)}
                            </span>
                            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                              Orden: {courseCustomOrder}
                            </span>
                            <p className="text-sm text-slate-600">Examenes: {countCourseExams(course)}</p>
                            {!isOwnerCourse ? (
                              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                Compartido contigo
                              </span>
                            ) : null}
                          </div>

                        </div>

                        {isOwnerCourse ? (
                          <div className="relative self-end sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setCourseActionMenuId((current) => (current === course.id ? null : course.id))}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="h-4 w-4"
                              >
                                <circle cx="12" cy="5" r="1.6" />
                                <circle cx="12" cy="12" r="1.6" />
                                <circle cx="12" cy="19" r="1.6" />
                              </svg>
                            </button>

                            {courseActionMenuId === course.id ? (
                              <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenShareModal("course", course.id, course.name);
                                    setCourseActionMenuId(null);
                                  }}
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Compartir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenManageCourse(course)}
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Prioridad y orden
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenEditCourse(course)}
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenDeleteCourse(course)}
                                  disabled={deletingCourseId === course.id}
                                  className="w-full rounded-md px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-70"
                                >
                                  {deletingCourseId === course.id ? "Eliminando..." : "Eliminar"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                        );
                      })()}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </DataCard>

          {showCreateCourseModal ? (
            <ModalShell
              title="Crear curso"
              onClose={() => {
                setShowCreateCourseModal(false);
                setCourseName("");
                setCourseDescription("");
                setCourseCode("");
                setCourseVisibility("public");
                setCourseCoverImageData(null);
                setCourseCoverImageName("");
              }}
            >
              <form onSubmit={onCreateCourse} className="space-y-3">
                <input
                  value={courseName}
                  onChange={(event) => setCourseName(event.target.value)}
                  placeholder="Nombre del curso"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <textarea
                  value={courseDescription}
                  onChange={(event) => setCourseDescription(event.target.value)}
                  placeholder="Descripcion del curso"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={courseCode}
                    onChange={(event) => setCourseCode(event.target.value.toUpperCase())}
                    placeholder="Codigo del curso (opcional)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                  <select
                    value={courseVisibility}
                    onChange={(event) => setCourseVisibility(event.target.value as "public" | "private")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  >
                    <option value="public">Publico</option>
                    <option value="private">Privado</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Imagen del curso (opcional)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={async (event) => {
                      const selectedFile = event.target.files?.[0];

                      if (!selectedFile) {
                        setCourseCoverImageData(null);
                        setCourseCoverImageName("");
                        return;
                      }

                      const maxBytes = 5 * 1024 * 1024;
                      if (selectedFile.size > maxBytes) {
                        setCourseMessageType("error");
                        setCourseMessage("La imagen del curso debe pesar maximo 5 MB.");
                        setCourseCoverImageData(null);
                        setCourseCoverImageName("");
                        event.currentTarget.value = "";
                        return;
                      }

                      try {
                        const dataUrl = await fileToDataUrl(selectedFile);
                        setCourseCoverImageData(dataUrl);
                        setCourseCoverImageName(selectedFile.name);
                        setCourseMessage("");
                      } catch {
                        setCourseMessageType("error");
                        setCourseMessage("No se pudo leer la imagen seleccionada.");
                        setCourseCoverImageData(null);
                        setCourseCoverImageName("");
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                  />
                  {courseCoverImageData ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p className="truncate text-xs text-slate-600">{courseCoverImageName}</p>
                      <div className="mt-2 h-24 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <img src={courseCoverImageData} alt="Vista previa del curso" className="h-full w-full object-cover" />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Puedes cargar una portada para el curso.</p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCourseModal(false);
                      setCourseName("");
                      setCourseDescription("");
                      setCourseCode("");
                      setCourseVisibility("public");
                      setCourseCoverImageData(null);
                      setCourseCoverImageName("");
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCourse}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {creatingCourse ? "Creando..." : "Crear curso"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showCreateCourseSessionModal && openedCourse ? (
            <ModalShell
              title={`Crear sesion: ${openedCourse.name}`}
              onClose={() => {
                setShowCreateCourseSessionModal(false);
                setCourseSessionName("");
                setCourseSessionWeeklyContent("");
              }}
            >
              <form onSubmit={onCreateCourseSession} className="space-y-3">
                <p className="text-xs text-slate-600">
                  Prefijo automatico: <span className="font-semibold text-slate-800">{`SESION ${nextOpenedSessionOrder}:`}</span>
                </p>
                <input
                  value={courseSessionName}
                  onChange={(event) => setCourseSessionName(event.target.value)}
                  placeholder={`SESION ${nextOpenedSessionOrder}: Nombre de la sesion`}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <textarea
                  value={courseSessionWeeklyContent}
                  onChange={(event) => setCourseSessionWeeklyContent(event.target.value)}
                  placeholder="Contenido de la semana"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCourseSessionModal(false);
                      setCourseSessionName("");
                      setCourseSessionWeeklyContent("");
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCourseSession}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {creatingCourseSession ? "Creando..." : "Crear sesion"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showEditCourseSessionModal && editingCourseSessionId != null ? (
            <ModalShell
              title="Editar sesion"
              onClose={() => {
                setShowEditCourseSessionModal(false);
                setEditingCourseSessionId(null);
                setEditingCourseSessionName("");
                setEditingCourseSessionWeeklyContent("");
              }}
            >
              <form onSubmit={onUpdateCourseSession} className="space-y-3">
                <input
                  value={editingCourseSessionName}
                  onChange={(event) => setEditingCourseSessionName(event.target.value)}
                  placeholder="SESION 1: Nombre de la sesion"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <textarea
                  value={editingCourseSessionWeeklyContent}
                  onChange={(event) => setEditingCourseSessionWeeklyContent(event.target.value)}
                  placeholder="Descripcion de la sesion"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditCourseSessionModal(false);
                      setEditingCourseSessionId(null);
                      setEditingCourseSessionName("");
                      setEditingCourseSessionWeeklyContent("");
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={updatingCourseSession}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {updatingCourseSession ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showAddSessionContentModal && addingContentSessionId != null ? (
            <ModalShell
              title={`${editingSessionContentId == null ? "Anadir contenido" : "Editar contenido"}: ${addingContentSessionName || "Sesion"}`}
              onClose={resetSessionContentEditor}
            >
              <form onSubmit={onSaveSessionContent} className="space-y-3">
                <select
                  value={sessionContentType}
                  onChange={(event) => {
                    setSessionContentType(event.target.value as "video" | "pdf" | "word" | "portada" | "examen");
                    setSessionContentName("");
                    setSessionVideoLink("");
                    setSessionCoverImageData(null);
                    setSessionPdfFileName("");
                    setSessionPdfFileData(null);
                    setSessionWordFileName("");
                    setSessionWordFileData(null);
                    setSessionExamSourceId("");
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                >
                  <option value="video">Enlace de video</option>
                  <option value="pdf">Documento PDF</option>
                  <option value="word">Documento Word</option>
                  <option value="examen">Clonar examen</option>
                  <option value="portada">Imagen de portada</option>
                </select>

                <input
                  value={sessionContentName}
                  onChange={(event) => setSessionContentName(event.target.value)}
                  placeholder={
                    sessionContentType === "video"
                      ? "Nombre del video (ej. Enlace a clase YouTube)"
                      : sessionContentType === "pdf"
                        ? "Nombre del PDF (ej. Guia semana 1)"
                        : sessionContentType === "word"
                          ? "Nombre del Word (ej. Practica laboratorio)"
                          : sessionContentType === "examen"
                            ? "Nombre del contenido examen (ej. Repaso semana 1)"
                          : "Nombre de la portada (ej. Portada sesion 1)"
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />

                {sessionContentType === "video" ? (
                  <input
                    value={sessionVideoLink}
                    onChange={(event) => setSessionVideoLink(event.target.value)}
                    placeholder="Pega el enlace del video"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                ) : null}

                {sessionContentType === "examen" ? (
                  <div className="space-y-1">
                    <select
                      value={sessionExamSourceId}
                      onChange={(event) => setSessionExamSourceId(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    >
                      <option value="">Selecciona un examen</option>
                      {availableExams.map((exam) => (
                        <option key={exam.id} value={String(exam.id)}>
                          {exam.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">Se clonara este examen para cada usuario al iniciar repaso.</p>
                  </div>
                ) : null}

                {sessionContentType === "pdf" ? (
                  <div className="space-y-1">
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={async (event) => {
                        const selectedFile = event.target.files?.[0];
                        if (!selectedFile) {
                          return;
                        }
                        const maxBytes = 5 * 1024 * 1024;
                        if (selectedFile.size > maxBytes) {
                          setCourseFeedback("El PDF debe pesar maximo 5 MB.", "error");
                          event.currentTarget.value = "";
                          return;
                        }
                        const lowerName = selectedFile.name.toLowerCase();
                        if (!lowerName.endsWith(".pdf")) {
                          setCourseFeedback("Solo se permiten archivos PDF.", "error");
                          event.currentTarget.value = "";
                          return;
                        }
                        try {
                          const dataUrl = await fileToDataUrl(selectedFile);
                          setSessionPdfFileName(selectedFile.name);
                          setSessionPdfFileData(dataUrl);
                          setCourseMessage("");
                        } catch {
                          setCourseFeedback("No se pudo leer el PDF.", "error");
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                    />
                    <p className="truncate text-xs text-slate-500">
                      {sessionPdfFileName ? `PDF listo: ${sessionPdfFileName}` : "Selecciona un PDF"}
                    </p>
                  </div>
                ) : null}

                {sessionContentType === "word" ? (
                  <div className="space-y-1">
                    <input
                      type="file"
                      accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={async (event) => {
                        const selectedFile = event.target.files?.[0];
                        if (!selectedFile) {
                          return;
                        }
                        const maxBytes = 5 * 1024 * 1024;
                        if (selectedFile.size > maxBytes) {
                          setCourseFeedback("El Word debe pesar maximo 5 MB.", "error");
                          event.currentTarget.value = "";
                          return;
                        }
                        const lowerName = selectedFile.name.toLowerCase();
                        if (!lowerName.endsWith(".doc") && !lowerName.endsWith(".docx")) {
                          setCourseFeedback("Solo se permiten archivos Word (.doc, .docx).", "error");
                          event.currentTarget.value = "";
                          return;
                        }
                        try {
                          const dataUrl = await fileToDataUrl(selectedFile);
                          setSessionWordFileName(selectedFile.name);
                          setSessionWordFileData(dataUrl);
                          setCourseMessage("");
                        } catch {
                          setCourseFeedback("No se pudo leer el Word.", "error");
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                    />
                    <p className="truncate text-xs text-slate-500">
                      {sessionWordFileName ? `Word listo: ${sessionWordFileName}` : "Selecciona un Word"}
                    </p>
                  </div>
                ) : null}

                {sessionContentType === "portada" ? (
                  <div className="space-y-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (event) => {
                        const selectedFile = event.target.files?.[0];
                        if (!selectedFile) {
                          return;
                        }
                        const maxBytes = 2 * 1024 * 1024;
                        if (selectedFile.size > maxBytes) {
                          setCourseFeedback("La imagen de portada debe pesar maximo 2 MB.", "error");
                          event.currentTarget.value = "";
                          return;
                        }
                        try {
                          const dataUrl = await fileToDataUrl(selectedFile);
                          setSessionCoverImageData(dataUrl);
                          setCourseMessage("");
                        } catch {
                          setCourseFeedback("No se pudo leer la portada de la sesion.", "error");
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                    />
                    {sessionCoverImageData ? (
                      <div className="h-24 w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <img src={sessionCoverImageData} alt="Portada seleccionada" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Selecciona una imagen para portada</p>
                    )}
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetSessionContentEditor}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingSessionContent}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {savingSessionContent
                      ? "Guardando..."
                      : editingSessionContentId == null
                        ? "Guardar"
                        : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showEditCourseModal && editingCourseId != null ? (
            <ModalShell
              title="Editar curso"
              onClose={() => {
                setShowEditCourseModal(false);
                setEditingCourseId(null);
                setEditingCourseName("");
                setEditingCourseDescription("");
                setEditingCourseCode("");
                setEditingCourseVisibility("public");
              }}
            >
              <form onSubmit={onUpdateCourse} className="space-y-3">
                <input
                  value={editingCourseName}
                  onChange={(event) => setEditingCourseName(event.target.value)}
                  placeholder="Nombre del curso"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <textarea
                  value={editingCourseDescription}
                  onChange={(event) => setEditingCourseDescription(event.target.value)}
                  placeholder="Descripcion del curso"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={editingCourseCode}
                    onChange={(event) => setEditingCourseCode(event.target.value.toUpperCase())}
                    placeholder="Codigo del curso (opcional)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                  <select
                    value={editingCourseVisibility}
                    onChange={(event) => setEditingCourseVisibility(event.target.value as "public" | "private")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  >
                    <option value="public">Publico</option>
                    <option value="private">Privado</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditCourseModal(false);
                      setEditingCourseId(null);
                      setEditingCourseName("");
                      setEditingCourseDescription("");
                      setEditingCourseCode("");
                      setEditingCourseVisibility("public");
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingCourseId === editingCourseId}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {savingCourseId === editingCourseId ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showManageCourseModal && managingCourse != null ? (
            <ModalShell
              title={`Gestionar curso: ${managingCourse.name}`}
              onClose={() => {
                setShowManageCourseModal(false);
                setManagingCourseId(null);
              }}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Configura la prioridad y el orden para decidir como aparece este curso en tu lista.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-slate-700">Prioridad</label>
                    <select
                      value={managingCoursePriority}
                      onChange={(event) =>
                        setManagingCoursePriority(
                          event.target.value as "very_important" | "important" | "low_important" | "optional",
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                    >
                      <option value="very_important">Muy importante</option>
                      <option value="important">Importante</option>
                      <option value="low_important">Poco importante</option>
                      <option value="optional">Opcional</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-slate-700">Orden</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={managingCourseSortOrder}
                      onChange={(event) => setManagingCourseSortOrder(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowManageCourseModal(false);
                      setManagingCourseId(null);
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    onClick={() => void onSaveCourseManage(managingCourse)}
                    disabled={savingCourseId === managingCourse.id}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {savingCourseId === managingCourse.id ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}

          {courseContentPreviewOpen ? (
            <ModalShell title={courseContentPreviewTitle || "Vista previa"} onClose={onCloseCourseContentPreview}>
              <div className="space-y-3">
                <div className="h-[70vh] overflow-hidden rounded-lg border border-slate-200 bg-black/5">
                  {courseContentPreviewType === "video" ? (
                    <iframe
                      src={courseContentPreviewUrl}
                      title={courseContentPreviewTitle || "Video"}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <iframe
                      src={courseContentPreviewUrl}
                      title={courseContentPreviewTitle || "Documento"}
                      className="h-full w-full bg-white"
                    />
                  )}
                </div>
                <div className="flex justify-end">
                  <a
                    href={courseContentPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Abrir en nueva pestana
                  </a>
                </div>
              </div>
            </ModalShell>
          ) : null}

          {showDeleteCourseModal && deleteCourseTarget != null ? (
            <ModalShell
              title="Eliminar curso"
              onClose={() => {
                if (deletingCourseId != null) {
                  return;
                }
                setShowDeleteCourseModal(false);
                setDeleteCourseTarget(null);
              }}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Vas a eliminar el curso <span className="font-semibold">{deleteCourseTarget.name}</span>.
                </p>
                <p className="text-sm text-rose-700">
                  Esta accion quitara tambien sus asociaciones de examenes.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteCourseModal(false);
                      setDeleteCourseTarget(null);
                    }}
                    disabled={deletingCourseId != null}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void onConfirmDeleteCourse()}
                    disabled={deletingCourseId === deleteCourseTarget.id}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-70"
                  >
                    {deletingCourseId === deleteCourseTarget.id ? "Eliminando..." : "Eliminar"}
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}
        </div>
      );
    }

    if (active === "ia") {
      const data = isIaChatSummaryArrayPayload(payload) ? payload : [];
      const iaMessages = iaSelectedChat?.messages ?? [];

      return (
        <div className="grid h-full min-h-0 w-full gap-4 lg:grid-cols-[320px_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Chats IA</h2>
            <p className="mt-1 text-xs text-slate-600">Crea o selecciona un chat.</p>

            <div className="mt-3">
              <button
                type="button"
                onClick={onCreateIaChat}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
              >
                Nuevo chat
              </button>
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {data.length === 0 ? (
                <EmptyState text="No hay chats aun." />
              ) : (
                data.map((item) => (
                  <div
                    key={item.id}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      iaSelectedChatId === item.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => void loadIaChat(item.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-600">Mensajes: {item.messagesCount ?? 0}</p>
                      </button>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setIaChatMenuOpenId((current) => (current === item.id ? null : item.id))
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                          title="Opciones del chat"
                          aria-label={`Opciones del chat ${item.name}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-4 w-4"
                          >
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>

                        {iaChatMenuOpenId === item.id ? (
                          <div className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => void onShareIaChat(item)}
                              className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                            >
                              Compartir
                            </button>
                            <button
                              type="button"
                              onClick={() => onArchiveIaChat(item)}
                              className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                            >
                              Archivar
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteIaChat(item)}
                              className="w-full rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                            >
                              Eliminar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIaFeedback("Mas opciones disponibles pronto.", "info");
                                setIaChatMenuOpenId(null);
                              }}
                              className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                            >
                              Mas opciones
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Panel IA</h2>
            {iaStatus ? (
              <div
                className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                  iaStatusType === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : iaStatusType === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-blue-200 bg-blue-50 text-blue-700"
                }`}
              >
                {iaStatus}
              </div>
            ) : null}

            {iaLoadingChat ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Cargando chat...
              </div>
            ) : (
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-900">Bienvenido al chat IA</p>
                  <p className="text-xs text-slate-600">
                    {iaIsNewChatMode || iaSelectedChat == null
                      ? "Escribe tu primer mensaje para crear este nuevo chat."
                      : "Escribe tu mensaje abajo o adjunta archivos para continuar."}
                  </p>
                </div>
                <div className="grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {iaMessages.length === 0 ? (
                      <div className="flex h-full min-h-[180px] items-center justify-center">
                        <div className="text-center">
                          <p className="text-sm font-semibold text-slate-700">Listo para tu primer mensaje.</p>
                          <p className="mt-1 text-xs text-slate-500">Escribe tu consulta o adjunta archivos para empezar.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {iaMessages.map((message) => {
                          const isAssistant = message.role === "assistant";
                          const examId = isAssistant ? extractExamIdFromContent(message.content) : null;
                          return (
                            <div key={message.id} className="flex">
                              <article
                                className={`w-full rounded-xl border px-4 py-3 ${
                                  isAssistant
                                    ? "border-slate-200 bg-white text-slate-900"
                                    : "border-slate-200 bg-slate-50 text-slate-900"
                                }`}
                              >
                                <p
                                  className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${
                                    isAssistant ? "text-slate-500" : "text-blue-700"
                                  } ${isAssistant ? "text-left" : "text-right"}`}
                                >
                                  {isAssistant ? "Asistente IA" : "Tu mensaje"}
                                </p>
                                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isAssistant ? "text-left" : "text-right"}`}>
                                  {message.content}
                                </p>
                                {examId ? (
                                  <div className="mt-2">
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActive("examenes");
                                          setExamFeedback("Examen generado con IA listo en tu lista de examenes.", "success");
                                        }}
                                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                                      >
                                        Ver en examenes
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void onStartPracticeFromIa(examId);
                                        }}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                      >
                                        Iniciar ahora
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </article>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {iaExamFiles.length > 0 ? (
                    <form onSubmit={onGenerateExamFromIa} className="border-t border-slate-200 bg-white p-3">
                      <p className="text-sm font-semibold text-slate-900">
                        Material recibido. Define el nombre y cuantas preguntas quieres.
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Archivos: {iaExamFiles.map((file) => file.name).join(", ")}
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_180px_auto]">
                        <input
                          value={iaExamName}
                          onChange={(event) => setIaExamName(event.target.value)}
                          placeholder="Nombre del examen"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          required
                        />
                        <input
                          type="number"
                          min={10}
                          max={100}
                          value={iaExamQuestionsCount}
                          onChange={(event) => setIaExamQuestionsCount(event.target.value)}
                          placeholder="Preguntas"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          required
                        />
                        <button
                          type="submit"
                          disabled={iaGeneratingExam}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                        >
                          {iaGeneratingExam ? "Generando..." : "Generar examen"}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <form onSubmit={onSendIaMessage} className="space-y-2 border-t border-slate-200 bg-white p-3">
                  {iaChatAttachments.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-600">Adjuntos listos</p>
                      <div className="flex flex-wrap gap-2">
                        {iaChatAttachments.map((file, index) => {
                          const lowerName = file.name.toLowerCase();
                          const extension = lowerName.endsWith(".pdf")
                            ? "PDF"
                            : lowerName.endsWith(".docx")
                              ? "DOCX"
                              : "DOC";
                          const extensionClass =
                            extension === "PDF"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-blue-100 text-blue-700";

                          return (
                            <div
                              key={`${file.name}-${index}`}
                              className="inline-flex max-w-[280px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                            >
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${extensionClass}`}
                              >
                                {extension}
                              </span>
                              <span className="truncate text-xs text-slate-700" title={file.name}>
                                {file.name}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setIaChatAttachments((files) => files.filter((_, fileIndex) => fileIndex !== index))
                                }
                                className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
                                aria-label={`Quitar ${file.name}`}
                                title={`Quitar ${file.name}`}
                              >
                                x
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <label
                      htmlFor="ia-chat-attachments"
                      className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Adjuntar
                    </label>
                    <input
                      key={iaAttachmentInputKey}
                      id="ia-chat-attachments"
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      multiple
                      onChange={(event) => setIaChatAttachments(Array.from(event.target.files ?? []).slice(0, 3))}
                      className="hidden"
                    />
                    <input
                      value={iaDraftMessage}
                      onChange={(event) => setIaDraftMessage(event.target.value)}
                      placeholder="Escribe tu mensaje..."
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    />
                    <select
                      value={iaSelectedModel}
                      onChange={(event) => setIaSelectedModel(event.target.value)}
                      disabled={iaLoadingModels || iaModels.length === 0}
                      className="w-44 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 disabled:bg-slate-100"
                      title="Modelo IA"
                    >
                      {iaModels.length === 0 ? (
                        <option value="">{iaLoadingModels ? "Cargando..." : "Modelo por defecto"}</option>
                      ) : (
                        iaModels.map((modelName) => (
                          <option key={modelName} value={modelName}>
                            {modelName}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="submit"
                      disabled={iaSendingMessage}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                    >
                      {iaSendingMessage ? "Enviando..." : "Enviar"}
                    </button>
                  </div>
                </form>
                </div>
              </div>
            )}
          </section>
        </div>
      );
    }

    if (active === "examenes") {
      const data = (Array.isArray(payload) ? payload : []) as ExamSummary[];
      const query = examSearch.trim().toLowerCase();
      const searched = query ? data.filter((item) => item.name.toLowerCase().includes(query)) : data;
      const filtered = searched.filter((item) => {
        const attempts = item.attemptsCount ?? 0;
        const questions = item.questionsCount ?? 0;

        if (examAttemptsFilter === "with_attempts" && attempts <= 0) {
          return false;
        }
        if (examAttemptsFilter === "without_attempts" && attempts > 0) {
          return false;
        }
        if (examQuestionsFilter === "with_questions" && questions <= 0) {
          return false;
        }
        if (examQuestionsFilter === "without_questions" && questions > 0) {
          return false;
        }
        return true;
      });
      const perPage = Number.parseInt(examPerPage, 10);
      const pageSize = Number.isNaN(perPage) ? 20 : Math.max(1, perPage);
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const currentPage = Math.min(examPage, totalPages);
      const pageStart = (currentPage - 1) * pageSize;
      const visible = filtered.slice(pageStart, pageStart + pageSize);
      const firstVisibleRow = filtered.length === 0 ? 0 : pageStart + 1;
      const lastVisibleRow = filtered.length === 0 ? 0 : pageStart + visible.length;
      const pageWindowStart = Math.max(1, currentPage - 2);
      const pageWindowEnd = Math.min(totalPages, currentPage + 2);
      const pageNumbers = Array.from(
        { length: pageWindowEnd - pageWindowStart + 1 },
        (_, index) => pageWindowStart + index,
      );

      if (showGroupPracticeRunnerModal && selectedExam && groupPracticeState) {
        const currentGroupQuestion = groupPracticeState.currentQuestion ?? null;
        const currentGroupQuestionKey = buildGroupQuestionKey(groupPracticeState);
        const liveCurrentAnswers = groupPracticeState.currentAnswers ?? [];
        const cachedCurrentAnswers =
          currentGroupQuestionKey == null ? [] : (groupAnswersByQuestionKey[currentGroupQuestionKey] ?? []);
        const currentQuestionAnswers = mergeGroupAnswers(cachedCurrentAnswers, liveCurrentAnswers);
        const currentQuestionAnswerByUserId = new Map<string, ExamGroupCurrentAnswer>();
        for (const answer of currentQuestionAnswers) {
          const key = normalizeGroupUserKey(answer.userId);
          const previous = currentQuestionAnswerByUserId.get(key);
          if (!previous) {
            currentQuestionAnswerByUserId.set(key, answer);
            continue;
          }
          const incomingText = (answer.selectedAnswer ?? "").trim();
          const previousText = (previous.selectedAnswer ?? "").trim();
          currentQuestionAnswerByUserId.set(key, {
            ...previous,
            ...answer,
            selectedAnswer: incomingText || previousText,
          });
        }
        const myParticipant = user
          ? groupPracticeState.participants.find((participant) => participant.userId === user.id) ?? null
          : null;
        const canStartGroup = Boolean(groupPracticeState.canStartGroup);
        const waitingParticipants = groupPracticeState.participants;
        const connectedWaitingParticipants = waitingParticipants.filter((participant) => Boolean(participant.connected));
        const toNumericScore = (value: number | null | undefined): number => {
          const normalized = Number(value ?? 0);
          return Number.isFinite(normalized) ? normalized : 0;
        };
        const finalRanking = (groupPracticeState.finalRanking ?? [])
          .slice()
          .sort((a, b) => {
            const byFinalScore = toNumericScore(b.finalScore) - toNumericScore(a.finalScore);
            if (byFinalScore !== 0) {
              return byFinalScore;
            }

            const byBaseScore = toNumericScore(b.baseScore) - toNumericScore(a.baseScore);
            if (byBaseScore !== 0) {
              return byBaseScore;
            }

            const byCorrectCount = toNumericScore(b.correctCount) - toNumericScore(a.correctCount);
            if (byCorrectCount !== 0) {
              return byCorrectCount;
            }

            return toNumericScore(a.rank) - toNumericScore(b.rank);
          });
        const connectedParticipantCount = connectedWaitingParticipants.length;
        const answeredConnectedCount = connectedWaitingParticipants.filter((participant) => {
          const answer = currentQuestionAnswerByUserId.get(normalizeGroupUserKey(participant.userId));
          return Boolean((answer?.selectedAnswer ?? "").trim());
        }).length;
        const allConnectedAnsweredCurrent =
          connectedParticipantCount > 0 && answeredConnectedCount >= connectedParticipantCount;
        const expiredForCurrentQuestion =
          Boolean(groupTimerExpired) &&
          currentGroupQuestionKey != null &&
          groupTimerExpiredQuestionKey === currentGroupQuestionKey;
        const shouldRevealCurrentQuestion = expiredForCurrentQuestion || allConnectedAnsweredCurrent;
        const isReviewWindow =
          shouldRevealCurrentQuestion &&
          groupAutoAdvanceSecondsLeft != null &&
          groupAutoAdvanceSecondsLeft > 0 &&
          currentGroupQuestionKey != null &&
          groupReviewQuestionKeyRef.current === currentGroupQuestionKey;
        const normalizeReviewToken = (value: string | null | undefined): string =>
          (value ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .trim();
        const groupQuestionOptionEntries =
          currentGroupQuestion?.questionType === "multiple_choice"
            ? ([
                currentGroupQuestion.optionA,
                currentGroupQuestion.optionB,
                currentGroupQuestion.optionC,
                currentGroupQuestion.optionD,
              ]
                .filter((value): value is string => Boolean(value && value.trim() !== ""))
                .slice(0, 4)
                .map((value, index) => ({
                  key: (index === 0 ? "a" : index === 1 ? "b" : index === 2 ? "c" : "d") as
                    | "a"
                    | "b"
                    | "c"
                    | "d",
                  value,
                })))
            : [];
        const resolveGroupOptionTextByKey = (key: string | null | undefined): string => {
          const normalizedKey = (key ?? "").toLowerCase();
          if (normalizedKey !== "a" && normalizedKey !== "b" && normalizedKey !== "c" && normalizedKey !== "d") {
            return "";
          }
          return groupQuestionOptionEntries.find((entry) => entry.key === normalizedKey)?.value ?? "";
        };
        const myCurrentAnswer = user
          ? currentQuestionAnswers.find((answer) => answer.userId === user.id) ?? null
          : null;
        const myCurrentAnswerByMap = user
          ? currentQuestionAnswerByUserId.get(normalizeGroupUserKey(user.id))
          : null;
        const hasCurrentLocalDraft =
          currentGroupQuestionKey != null && groupDraftQuestionKey === currentGroupQuestionKey;
        const effectivePracticeSelectedOption = hasCurrentLocalDraft ? practiceSelectedOption : null;
        const effectivePracticeWrittenAnswer = hasCurrentLocalDraft ? practiceWrittenAnswer : "";
        const myAnsweredByCurrentData = Boolean((myCurrentAnswerByMap?.selectedAnswer ?? "").trim());
        const myAnswered =
          myAnsweredByCurrentData ||
          (currentGroupQuestionKey != null && groupSubmittedQuestionKey === currentGroupQuestionKey);
        const myCurrentAnswerText = myCurrentAnswer
          ? currentGroupQuestion?.questionType === "multiple_choice"
            ? (() => {
                const byKey = resolveGroupOptionTextByKey(myCurrentAnswer.selectedOptionKey);
                if (byKey) {
                  return byKey;
                }
                const selected = normalizeReviewToken(myCurrentAnswer.selectedAnswer);
                if (selected === "a" || selected === "b" || selected === "c" || selected === "d") {
                  const bySelectedKey = resolveGroupOptionTextByKey(selected);
                  if (bySelectedKey) {
                    return bySelectedKey;
                  }
                }
                return myCurrentAnswer.selectedAnswer ?? "-";
              })()
            : (myCurrentAnswer.selectedAnswer ?? "-")
          : null;

        return (
          <div className="space-y-4 text-sm [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-base">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Repaso grupal: {selectedExam.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Estado:{" "}
                    <span className="font-semibold">
                      {groupPracticeState.status === "waiting"
                        ? "En espera"
                        : groupPracticeState.status === "active"
                          ? "Activo"
                          : "Finalizado"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canStartGroup && groupPracticeState.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => void onCloseAndRestartGroupPractice()}
                      disabled={closingAndRestartingGroupPractice}
                      className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {closingAndRestartingGroupPractice ? "Finalizando..." : "Finalizar e ir a espera"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onCloseGroupPracticeRunner}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {practiceOriginSection === "ia"
                      ? "Volver a IA"
                      : practiceOriginSection === "cursos"
                        ? "Volver a cursos"
                        : "Volver a examenes"}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                  Sesion #{groupPracticeState.sessionId}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                  Participantes conectados:{" "}
                  {connectedWaitingParticipants.length}
                </span>
                {groupPracticeState.status === "active" && currentGroupQuestion ? (
                  <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-800">
                    Pregunta {groupPracticeState.currentQuestionIndex + 1} de {groupPracticeState.totalQuestions}
                  </span>
                ) : null}
              </div>

              <div className="mt-3">
                <div className="space-y-3">
                  {groupPracticeState.status === "waiting" ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm text-slate-700">Sala grupal en espera. Cuando estén listos, inicia el repaso.</p>
                      <div className="mt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void onStartGroupPracticeSession()}
                            disabled={!canStartGroup || groupPracticeLoading || closingGroupWaitingRoom}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {groupPracticeLoading ? "Iniciando..." : "Iniciar con conectados"}
                          </button>
                          {canStartGroup ? (
                            <button
                              type="button"
                              onClick={() => void onCloseGroupWaitingRoom()}
                              disabled={closingGroupWaitingRoom || groupPracticeLoading}
                              className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {closingGroupWaitingRoom ? "Cerrando sala..." : "Cerrar sala de espera"}
                            </button>
                          ) : null}
                        </div>
                        {!canStartGroup ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Espera a un usuario con permiso de inicio grupal.
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Participantes en sala</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {connectedWaitingParticipants.map((participant) => {
                            const initials = (participant.name || "?")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase() ?? "")
                              .join("");

                            return (
                              <div key={`waiting-user-${participant.userId}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                                <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-200 text-[10px] font-bold text-slate-700">
                                  {participant.profileImageUrl ? (
                                    <img
                                      src={participant.profileImageUrl}
                                      alt={participant.name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : participant.userId === user.id && profileImageData ? (
                                    <img
                                      src={profileImageData}
                                      alt={participant.name}
                                      className="h-full w-full object-cover"
                                      style={profileImagePreviewStyle}
                                    />
                                  ) : (
                                    initials || "?"
                                  )}
                                </span>
                                <p className="text-sm font-medium text-slate-800">@{participant.username}</p>
                              </div>
                            );
                          })}
                          {connectedWaitingParticipants.length === 0 ? (
                            <p className="text-xs text-slate-500">No hay participantes conectados en este momento.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {groupPracticeState.status === "active" && currentGroupQuestion ? (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <h4 className="text-base font-semibold text-slate-900">{currentGroupQuestion.questionText}</h4>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-white">
                            Puntaje: {currentGroupQuestion.points ?? 1}
                          </span>
                          <span className="rounded-full bg-blue-700 px-3 py-1 text-sm font-bold text-white">
                            Cronometro: {formatClock(isReviewWindow ? 0 : groupQuestionElapsedSeconds)}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-sm font-bold ${
                              groupQuestionRemainingSeconds != null && groupQuestionRemainingSeconds <= 5
                                ? "bg-red-600 text-white"
                                : "bg-amber-500 text-white"
                            }`}
                          >
                            Temporizador:{" "}
                            {isReviewWindow
                              ? formatClock(0)
                              : groupQuestionRemainingSeconds != null
                              ? formatClock(groupQuestionRemainingSeconds)
                              : formatClock(currentGroupQuestion.temporizadorSegundos ?? 0)}
                          </span>
                          {isReviewWindow ? (
                            <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm font-bold text-white">
                              Tiempo de revision: {formatClock(groupAutoAdvanceSecondsLeft)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {currentGroupQuestion.questionType === "multiple_choice" ? (
                        <>
                          <div className="space-y-2">
                            {groupQuestionOptionEntries.map(({ key, value }) => {
                                const normalizedOptionValue = normalizeReviewToken(value);
                                const normalizedCorrectOption = normalizeReviewToken(currentGroupQuestion.correctOption);
                                const normalizedCorrectAnswer = normalizeReviewToken(currentGroupQuestion.correctAnswer);
                                const isCorrectOption =
                                  normalizedCorrectOption === key ||
                                  normalizedCorrectAnswer === key ||
                                  (normalizedCorrectAnswer !== "" && normalizedCorrectAnswer === normalizedOptionValue);
                                const optionResponders = currentQuestionAnswers.filter((answer) => {
                                  const selectedOptionKey = (answer.selectedOptionKey ?? "").toLowerCase();
                                  const selected = normalizeReviewToken(answer.selectedAnswer);
                                  return selectedOptionKey === key || selected === key || (normalizedOptionValue !== "" && selected === normalizedOptionValue);
                                });

                                const myResolvedOptionKey = (() => {
                                  if (effectivePracticeSelectedOption) {
                                    return effectivePracticeSelectedOption;
                                  }
                                  const selectedOptionKey = (myCurrentAnswer?.selectedOptionKey ?? "").toLowerCase();
                                  if (selectedOptionKey === "a" || selectedOptionKey === "b" || selectedOptionKey === "c" || selectedOptionKey === "d") {
                                    return selectedOptionKey;
                                  }
                                  const selected = normalizeReviewToken(myCurrentAnswer?.selectedAnswer);
                                  if (selected === "a" || selected === "b" || selected === "c" || selected === "d") {
                                    return selected;
                                  }
                                  return null;
                                })();

                                const withMeFallback =
                                  isReviewWindow &&
                                  user &&
                                  myAnswered &&
                                  myResolvedOptionKey === key &&
                                  !optionResponders.some((answer) => answer.userId === user.id)
                                    ? [
                                        ...optionResponders,
                                        {
                                          userId: user.id,
                                          name: myCurrentAnswer?.name ?? user.name,
                                          username: myCurrentAnswer?.username ?? user.username,
                                          profileImageUrl: myCurrentAnswer?.profileImageUrl ?? null,
                                        },
                                      ]
                                    : optionResponders;

                                return (
                                  <div key={key} className="space-y-1.5">
                                  <label
                                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                                      isReviewWindow
                                        ? isCorrectOption
                                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                          : "border-rose-300 bg-rose-50 text-rose-900"
                                        : "border-slate-300 bg-white text-slate-800"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="group_practice_option"
                                      value={key}
                                      checked={effectivePracticeSelectedOption === key}
                                      onChange={() => {
                                        setPracticeSelectedOption(key);
                                        setGroupDraftQuestionKey(currentGroupQuestionKey);
                                      }}
                                      disabled={myAnswered || submittingGroupAnswer}
                                    />
                                    <span>{value}</span>
                                  </label>

                                  {isReviewWindow && withMeFallback.length > 0 ? (
                                    <div className="ml-6 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {withMeFallback.map((answer) => {
                                          const initials = (answer.name || "?")
                                            .split(" ")
                                            .filter(Boolean)
                                            .slice(0, 2)
                                            .map((part) => part[0]?.toUpperCase() ?? "")
                                            .join("");
                                          const isMe = answer.userId === user.id;

                                          return (
                                            <span
                                              key={`review-option-${key}-${answer.userId}`}
                                              title={`${answer.name}${answer.username ? ` (@${answer.username})` : ""}`}
                                              className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-blue-400 bg-slate-200 text-[9px] font-bold text-slate-700"
                                            >
                                              {answer.profileImageUrl ? (
                                                <img
                                                  src={answer.profileImageUrl}
                                                  alt={answer.name}
                                                  className="h-full w-full object-cover"
                                                />
                                              ) : isMe && profileImageData ? (
                                                <img
                                                  src={profileImageData}
                                                  alt={answer.name}
                                                  className="h-full w-full object-cover"
                                                  style={profileImagePreviewStyle}
                                                />
                                              ) : (
                                                initials || "?"
                                              )}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                  </div>
                                );
                              })}
                          </div>

                        </>
                      ) : (
                        <>
                          {!isReviewWindow ? (
                            <div className="space-y-2">
                              <textarea
                                value={effectivePracticeWrittenAnswer}
                                onChange={(event) => {
                                  setPracticeWrittenAnswer(event.target.value);
                                  setGroupDraftQuestionKey(currentGroupQuestionKey);
                                }}
                                placeholder="Tu respuesta grupal"
                                disabled={myAnswered || submittingGroupAnswer}
                                className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 disabled:bg-slate-100"
                              />
                            </div>
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                  Respuesta correcta
                                </p>
                                <p className="mt-1 text-sm font-semibold text-emerald-900 break-words">
                                  {(currentGroupQuestion.correctAnswer ?? "").trim() || "Sin respuesta correcta registrada."}
                                </p>
                              </div>

                              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Respuestas en revision
                              </p>
                              <div className="mt-2 space-y-2">
                                {waitingParticipants.map((participant, index) => {
                                  const answer = currentQuestionAnswerByUserId.get(normalizeGroupUserKey(participant.userId));
                                  const isCorrectAnswer =
                                    answer?.correct != null ? Boolean(answer.correct) : participant.correctCurrent;
                                  const answerText =
                                    (answer?.selectedAnswer ?? "").trim() ||
                                    (participant.userId === user?.id && myAnswered ? practiceWrittenAnswer.trim() : "") ||
                                    "(Sin respuesta)";
                                  const cardClass =
                                    isCorrectAnswer == null
                                      ? "border-slate-200 bg-slate-50"
                                      : isCorrectAnswer
                                      ? "border-emerald-300 bg-emerald-50"
                                      : "border-rose-300 bg-rose-50";
                                  const titleClass =
                                    isCorrectAnswer == null
                                      ? "text-slate-700"
                                      : isCorrectAnswer
                                      ? "text-emerald-800"
                                      : "text-rose-800";
                                  const textClass =
                                    isCorrectAnswer == null
                                      ? "text-slate-900"
                                      : isCorrectAnswer
                                      ? "text-emerald-900"
                                      : "text-rose-900";
                                  const initials = (participant.name || "?")
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((part) => part[0]?.toUpperCase() ?? "")
                                    .join("");

                                  return (
                                    <article key={`written-review-${participant.userId}-${index}`} className={`ml-4 md:ml-6 rounded-lg border px-3 py-2 ${cardClass}`}>
                                      <div className="flex items-start gap-2">
                                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-200 text-[10px] font-bold text-slate-700">
                                          {participant.profileImageUrl ? (
                                            <img
                                              src={participant.profileImageUrl}
                                              alt={participant.name}
                                              className="h-full w-full object-cover"
                                            />
                                          ) : participant.userId === user.id && profileImageData ? (
                                            <img
                                              src={profileImageData}
                                              alt={participant.name}
                                              className="h-full w-full object-cover"
                                              style={profileImagePreviewStyle}
                                            />
                                          ) : (
                                            initials || "?"
                                          )}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <p className={`text-xs font-semibold ${titleClass}`}>
                                            {participant.name}
                                            {participant.username ? ` (@${participant.username})` : ""}
                                          </p>
                                          <p className={`mt-1 text-sm break-words ${textClass}`}>
                                            {answerText}
                                          </p>
                                        </div>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void onSubmitGroupPracticeStep()}
                          disabled={myAnswered || submittingGroupAnswer || groupPracticeState.status !== "active"}
                          className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {myAnswered ? "Respuesta enviada" : submittingGroupAnswer ? "Enviando..." : "Enviar"}
                        </button>
                      </div>

                      {isReviewWindow && myCurrentAnswer ? (
                        <>
                          {(currentGroupQuestion.explanation ?? "").trim() ? (
                            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                                Explicacion
                              </p>
                              <p className="mt-1 text-sm text-indigo-900 break-words">
                                {(currentGroupQuestion.explanation ?? "").trim()}
                              </p>
                            </div>
                          ) : null}

                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              Tu respuesta en revision
                            </p>
                            <div className="mt-2 flex items-center gap-3">
                              <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-blue-500 bg-slate-200 text-[11px] font-bold text-slate-700">
                                {myCurrentAnswer.profileImageUrl ? (
                                  <img
                                    src={myCurrentAnswer.profileImageUrl}
                                    alt={myCurrentAnswer.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : profileImageData ? (
                                  <img
                                    src={profileImageData}
                                    alt={myCurrentAnswer.name}
                                    className="h-full w-full object-cover"
                                    style={profileImagePreviewStyle}
                                  />
                                ) : (
                                  (myCurrentAnswer.name || "?")
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((part) => part[0]?.toUpperCase() ?? "")
                                    .join("") || "?"
                                )}
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{myCurrentAnswer.name}</p>
                                <p className="text-sm text-slate-700 break-words">
                                  {currentGroupQuestion.questionType === "multiple_choice" ? "Marcaste" : "Escribiste"}: {myCurrentAnswerText}
                                </p>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}


                    </div>
                  ) : null}

                  {groupPracticeState.status === "finished" ? (
                    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      <p>Repaso grupal finalizado.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canStartGroup ? (
                          <button
                            type="button"
                            onClick={() => void onCloseAndRestartGroupPractice()}
                            disabled={closingAndRestartingGroupPractice}
                            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {closingAndRestartingGroupPractice ? "Volviendo..." : "Volver todos a espera"}
                          </button>
                        ) : (
                          <p className="text-xs text-emerald-700">Esperando al anfitrion para volver a estado de espera.</p>
                        )}
                      </div>

                      {finalRanking.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ranking final</p>
                          <div className="overflow-x-auto rounded-lg border border-emerald-200 bg-white shadow-sm">
                            <table className="min-w-[780px] w-full text-left text-xs text-slate-700 sm:text-sm">
                              <thead className="bg-emerald-100 text-[11px] uppercase tracking-wide text-emerald-800 sm:text-xs">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Puesto</th>
                                  <th className="px-3 py-2 font-semibold">Usuario</th>
                                  <th className="px-3 py-2 font-semibold">Bien</th>
                                  <th className="px-3 py-2 font-semibold">Mal</th>
                                  <th className="px-3 py-2 font-semibold">Base</th>
                                  <th className="px-3 py-2 font-semibold">Rapidez</th>
                                  <th className="px-3 py-2 font-semibold">Nota final</th>
                                </tr>
                              </thead>
                              <tbody>
                                {finalRanking.map((entry, index) => {
                                  const fullName = (entry.name ?? "Usuario").trim() || "Usuario";
                                  const username = (entry.username ?? "").trim();
                                  const initials = fullName
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((part) => part[0]?.toUpperCase() ?? "")
                                    .join("");
                                  const displayRank = index + 1;

                                  return (
                                    <tr key={`final-ranking-row-${entry.userId}`} className="border-t border-slate-200">
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">
                                          #{displayRank}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-200 text-[10px] font-bold text-slate-700">
                                            {entry.profileImageUrl ? (
                                              <img src={entry.profileImageUrl} alt={fullName} className="h-full w-full object-cover" />
                                            ) : (
                                              initials || "?"
                                            )}
                                          </span>
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-slate-900">{fullName}</p>
                                            <p className="truncate text-xs text-slate-600">@{username || "usuario"}</p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                                          {toNumericScore(entry.correctCount)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-medium text-rose-700">
                                          {toNumericScore(entry.wrongCount)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700">
                                          {toNumericScore(entry.baseScore)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                                          +{toNumericScore(entry.speedBonus)}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 align-middle">
                                        <span className="inline-flex rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-sm font-bold text-slate-900">
                                          {toNumericScore(entry.finalScore)}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

              </div>
            </section>
          </div>
        );
      }

      if (showPracticeRunnerModal && selectedExam) {
        return (
          <div className="space-y-4 text-sm [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-base">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Repaso: {selectedExam.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">Modulo de repaso activo.</p>
                </div>
                <button
                  type="button"
                  onClick={onClosePracticeRunnerWithoutSave}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {practiceOriginSection === "ia"
                    ? "Volver a IA sin guardar"
                    : practiceOriginSection === "cursos"
                      ? "Volver a cursos sin guardar"
                      : "Volver a examenes sin guardar"}
                </button>
              </div>
            </section>

            {practiceFinished ? (
              <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-700">Resultado del repaso.</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="text-xs font-semibold uppercase text-slate-500">Total</p>
                    <p className="text-xl font-semibold text-slate-900">{practiceStats.total}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    <p className="text-xs font-semibold uppercase text-emerald-600">Correctas</p>
                    <p className="text-xl font-semibold">{practiceStats.correct}</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    <p className="text-xs font-semibold uppercase text-rose-600">Incorrectas</p>
                    <p className="text-xl font-semibold">{practiceStats.incorrect}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    <p className="text-xs font-semibold uppercase text-amber-600">No respondidas</p>
                    <p className="text-xl font-semibold">{practiceStats.unanswered}</p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClosePracticeRunner}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPracticeIntent("restart");
                      void onStartPractice(undefined, true);
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Reintentar
                  </button>
                </div>
              </section>
            ) : currentPracticeQuestion ? (
              <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      Pregunta {practiceIndex + 1} de {practiceQuestions.length}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      Modo: {practiceFeedbackMode === "with_feedback" ? "Verificacion + explicacion" : "Flujo continuo"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      Orden: {practiceOrderMode === "random" ? "Aleatorio" : "En orden"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      Avance:{" "}
                      {practiceProgressMode === "repeat_until_correct" ? "Repetir hasta acertar" : "Pasar aunque este mal"}
                    </span>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                      Cronometro: {formatClock(practiceChronoSeconds)}
                    </span>
                    <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                      Temporizador: {practiceRemainingSeconds == null ? "Sin limite" : formatClock(practiceRemainingSeconds)}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="text-base font-semibold text-slate-900">{currentPracticeQuestion.questionText}</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Puntaje: {currentPracticeQuestion.points ?? 1} | Temporizador:{" "}
                    {currentPracticeQuestion.temporizadorSegundos ?? 0}s
                  </p>
                </div>

                {currentPracticeQuestion.questionType === "multiple_choice" ? (
                  <div className="space-y-2">
                    {(
                      [
                        ["a", currentPracticeQuestion.optionA],
                        ["b", currentPracticeQuestion.optionB],
                        ["c", currentPracticeQuestion.optionC],
                        ["d", currentPracticeQuestion.optionD],
                      ] as Array<["a" | "b" | "c" | "d", string | null | undefined]>
                    )
                      .filter(([, value]) => !!value && value.trim() !== "")
                      .map(([key, value]) => (
                        <label
                          key={key}
                          className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        >
                          <input
                            type="radio"
                            name="practice_option"
                            value={key}
                            checked={practiceSelectedOption === key}
                            disabled={practiceFeedbackStatus != null}
                            onChange={() => setPracticeSelectedOption(key)}
                          />
                          <span>{value}</span>
                        </label>
                      ))}
                  </div>
                ) : (
                  <textarea
                    value={practiceWrittenAnswer}
                    disabled={practiceFeedbackStatus != null}
                    onChange={(event) => setPracticeWrittenAnswer(event.target.value)}
                    placeholder="Tu respuesta"
                    className="min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                  />
                )}

                {practiceFeedbackStatus ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      practiceFeedbackStatus === "correct"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : practiceFeedbackStatus === "incorrect"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {practiceFeedbackStatus === "correct"
                      ? "Respuesta correcta."
                      : practiceFeedbackStatus === "incorrect"
                        ? "Respuesta incorrecta."
                        : "No respondiste esta pregunta."}
                  </div>
                ) : null}

                {practiceFeedbackMode === "with_feedback" && practiceFeedbackStatus ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <p className="font-semibold text-slate-800">Explicacion</p>
                    <p>{currentPracticeQuestion.explanation || "No hay explicacion registrada para esta pregunta."}</p>
                    {practiceFeedbackStatus !== "correct" ? (
                      <p className="mt-2">
                        <span className="font-semibold">Respuesta correcta:</span>{" "}
                        {currentPracticeQuestion.questionType === "multiple_choice"
                          ? (resolveCorrectOption(currentPracticeQuestion) === "a"
                              ? currentPracticeQuestion.optionA
                              : resolveCorrectOption(currentPracticeQuestion) === "b"
                                ? currentPracticeQuestion.optionB
                                : resolveCorrectOption(currentPracticeQuestion) === "c"
                                  ? currentPracticeQuestion.optionC
                                  : currentPracticeQuestion.optionD) || "-"
                          : currentPracticeQuestion.correctAnswer || "-"}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClosePracticeRunner}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Guardar y salir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (practiceFeedbackStatus == null) {
                        onSubmitPracticeStep();
                        return;
                      }
                      onContinuePracticeAfterFeedback();
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {practiceFeedbackStatus == null
                      ? practiceFeedbackMode === "with_feedback"
                        ? "Responder"
                        : practiceIndex >= practiceQuestions.length - 1
                          ? "Finalizar repaso"
                          : "Siguiente"
                      : practiceProgressMode === "repeat_until_correct" && practiceFeedbackStatus !== "correct"
                        ? "Reintentar pregunta"
                        : practiceIndex >= practiceQuestions.length - 1
                          ? "Finalizar repaso"
                          : "Siguiente"}
                  </button>
                </div>
              </section>
            ) : (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-700">No hay preguntas disponibles para este repaso.</p>
              </section>
            )}
          </div>
        );
      }

      return (
        <div className="space-y-4 text-sm [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-base">
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Crear examen manual</h2>
              <p className="mt-2 text-sm text-slate-600">
                Escribe el nombre del examen y crea el examen para empezar a agregar preguntas una por una.
              </p>

              <form onSubmit={onCreateManualExam} className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-800">Nombre del examen</label>
                  <input
                    value={manualExamName}
                    onChange={(event) => setManualExamName(event.target.value)}
                    placeholder="Ejemplo: Simulacro semanal"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none focus:border-blue-400"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingManualExam}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                >
                  {creatingManualExam ? "Creando..." : "Crear examen manual"}
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Repasar examen con Excel</h2>
              <p className="mt-2 text-sm text-slate-600">
                Coloca un nombre al examen y sube el archivo Excel con los campos requeridos.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  className="rounded-lg border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
                >
                  Subir examen
                </button>
                <button
                  type="button"
                  onClick={() => setShowFormatModal(true)}
                  className="rounded-lg border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-600 hover:bg-cyan-50"
                >
                  Ver formato
                </button>
                <button
                  type="button"
                  onClick={onDownloadExamFormat}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Descargar formato
                </button>
              </div>
            </section>
          </div>

          <div className="border-t border-slate-300/80" />

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Examenes</h3>

            <div className="mt-4 rounded-lg border border-slate-300 p-3">
              <label className="mb-2 block text-base font-medium text-slate-800">Buscar examen</label>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <input
                  value={examSearch}
                  onChange={(event) => {
                    setExamSearch(event.target.value);
                    setExamPage(1);
                  }}
                  placeholder="Nombre del examen..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none focus:border-blue-400"
                />

                <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5">
                  <span className="text-sm font-semibold text-slate-600">Mostrar</span>
                  <select
                    value={examPerPage}
                    onChange={(event) => {
                      setExamPerPage(event.target.value);
                      setExamPage(1);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none"
                  >
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowExamFilters((value) => !value)}
                  className="rounded-lg border border-slate-400 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Filtros
                </button>
                <button
                  type="button"
                  onClick={() => setExamPage(1)}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Buscar
                </button>
              </div>

              {showExamFilters ? (
                <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Intentos</label>
                    <select
                      value={examAttemptsFilter}
                      onChange={(event) => {
                        setExamAttemptsFilter(
                          event.target.value as "all" | "with_attempts" | "without_attempts",
                        );
                        setExamPage(1);
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                    >
                      <option value="all">Todos</option>
                      <option value="with_attempts">Con intentos</option>
                      <option value="without_attempts">Sin intentos</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Preguntas</label>
                    <select
                      value={examQuestionsFilter}
                      onChange={(event) => {
                        setExamQuestionsFilter(
                          event.target.value as "all" | "with_questions" | "without_questions",
                        );
                        setExamPage(1);
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                    >
                      <option value="all">Todos</option>
                      <option value="with_questions">Con preguntas</option>
                      <option value="without_questions">Sin preguntas</option>
                    </select>
                  </div>

                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExamAttemptsFilter("all");
                        setExamQuestionsFilter("all");
                        setExamPage(1);
                      }}
                      className="rounded-lg border border-slate-400 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowExamFilters(false)}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {examMessage ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                  examMessageType === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : examMessageType === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-blue-200 bg-blue-50 text-blue-700"
                }`}
              >
                {examMessage}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {visible.length === 0 ? (
                <EmptyState text="No hay examenes aun." />
              ) : (
                visible.map((item) => {
                  const hasOpenPractice = hasOpenPracticeDraft(item.id);
                  const accessRole = (
                    item.accessRole ?? ((item.ownerUserId ?? 0) === (user?.id ?? 0) ? "owner" : "viewer")
                  ).toLowerCase();
                  const canEditQuestions = item.canEditQuestions ?? (accessRole === "owner" || accessRole === "editor");
                  const canEditSettings = item.canEditSettings ?? canEditQuestions;
                  const canShareExam = item.canShare ?? accessRole === "owner";
                  const canStartGroupExam = item.canStartGroup ?? accessRole === "owner";
                  const canRenameExam = item.canRenameExam ?? accessRole === "owner";
                  const isOwner = accessRole === "owner";
                  const visibility = (item.visibility ?? "private").toLowerCase() === "public" ? "public" : "private";
                  const participantsCount = Math.max(1, Number(item.participantsCount ?? 1));
                  const examCode = (item.code ?? "").trim() || `EXM-${String(item.id).padStart(6, "0")}`;
                  const personalPracticeCount = Number(item.personalPracticeCount ?? item.attemptsCount ?? 0);
                  const groupPracticeCount = Number(item.groupPracticeCount ?? 0);
                  const groupPracticeStatus = (item.groupPracticeStatus ?? "").toLowerCase();
                  const groupSessionActive = groupPracticeStatus === "waiting" || groupPracticeStatus === "active";
                  const isGroupCreator = (item.groupPracticeCreatedByUserId ?? 0) === (user?.id ?? 0);
                  const ownerUserId = item.ownerUserId ?? null;
                  const hasEditPermissions = canEditQuestions || canEditSettings;
                  const hasOpenGroupSession = groupSessionActive && item.groupPracticeSessionId != null;
                  const canStartGroupPractice = isOwner || canStartGroupExam;
                  const canJoinGroupPractice = hasOpenGroupSession;
                  const showGroupPracticeButton = canStartGroupPractice || canJoinGroupPractice;
                  const groupPracticeButtonLabel = canStartGroupPractice ? "Grupal" : "Unirse";
                  const isGroupButtonLoading = groupPracticeLoading && groupPracticeLoadingExamId === item.id;
                  return (
                  <article key={item.id} className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xl font-semibold text-slate-900">{item.name}</h4>
                          {canRenameExam ? (
                            <button
                              type="button"
                              onClick={() => void onRenameExamName(item)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                              aria-label="Editar nombre del examen"
                              title="Editar nombre del examen"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                                aria-hidden="true"
                              >
                                <path d="M12 20h9" />
                                <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5Z" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-500">
                          Cargado: {formatExamCreatedAt(item.createdAt, item.created_at)}
                        </p>
                        <p className="text-sm text-slate-500">Codigo: {examCode}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-semibold ${
                            visibility === "public" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"
                          }`}
                        >
                          {visibility === "public" ? "Publico" : "Privado"}
                        </span>
                        <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">
                          {accessRole === "owner" ? "Propietario" : accessRole === "editor" ? "Editor" : "Lector"}
                        </span>
                        <span className="rounded-full bg-sky-600 px-3 py-1 text-sm font-semibold text-white">
                          {participantsCount} participantes
                        </span>
                        <span className="rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white">
                          {item.questionsCount ?? 0} preguntas
                        </span>
                        <span className="rounded-full bg-slate-500 px-3 py-1 text-sm font-semibold text-white">
                          {personalPracticeCount} repasos personales
                        </span>
                        <span className="rounded-full bg-fuchsia-600 px-3 py-1 text-sm font-semibold text-white">
                          {groupPracticeCount} repasos grupales
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {canEditQuestions ? (
                        <button
                          type="button"
                          onClick={() => void onManageExamQuestions(item)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#374151] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1F2937]"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M4 19.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14.5" />
                            <path d="M8 7h8" />
                            <path d="M8 11h8" />
                            <path d="M8 15h5" />
                            <circle cx="18" cy="18" r="3" />
                            <path d="m20.2 20.2 1.3 1.3" />
                          </svg>
                          Preguntas
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setPracticeOriginSection("examenes");
                          setPracticeIntent("start");
                          void onStartPractice(item, false);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="h-4 w-4"
                          aria-hidden="true"
                        >
                          <path d="M8 5.5v13l10-6.5-10-6.5z" />
                        </svg>
                        Individual
                      </button>
                      {showGroupPracticeButton ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPracticeOriginSection("examenes");
                            if (canStartGroupPractice) {
                              if (groupSessionActive) {
                                void onJoinGroupPractice(item);
                              } else {
                                void onCreateGroupPractice(item);
                              }
                              return;
                            }
                            if (canJoinGroupPractice) {
                              void onJoinGroupPractice(item);
                            }
                          }}
                          disabled={groupPracticeLoading}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isGroupButtonLoading ? (
                            "Entrando..."
                          ) : (
                            <>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="h-4 w-4"
                                aria-hidden="true"
                              >
                                <path d="M8 5.5v13l10-6.5-10-6.5z" />
                              </svg>
                              {groupPracticeButtonLabel}
                            </>
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void onOpenExamParticipantsModal(item)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#4B5563] px-4 py-2 text-sm font-semibold text-white hover:bg-[#374151]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                          aria-hidden="true"
                        >
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        Participantes
                      </button>
                      {hasOpenPractice ? (
                        <button
                          type="button"
                          onClick={() => {
                            onResetPractice(item);
                          }}
                          className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                        >
                          Reiniciar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          void openIndividualPracticeSettingsModal(item);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#38BDF8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0EA5E9]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        Configuracion individual
                      </button>
                      {canEditSettings ? (
                        <button
                          type="button"
                          onClick={() => openGroupPracticeSettingsModal(item)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#3B82F6] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2563EB]"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                          Configuracion grupal
                        </button>
                      ) : null}
                      {canShareExam ? (
                        <button
                          type="button"
                          onClick={() => onOpenShareModal("exam", item.id, item.name)}
                          aria-label="Compartir"
                          title="Compartir"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#F9C200] text-white hover:bg-[#E0AD00]"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <circle cx="18" cy="5" r="3" />
                            <circle cx="6" cy="12" r="3" />
                            <circle cx="18" cy="19" r="3" />
                            <path d="M8.6 13.5l6.8 4" />
                            <path d="M15.4 6.5l-6.8 4" />
                          </svg>
                        </button>
                      ) : null}
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedExam(item);
                            setShowDeactivateModal(true);
                          }}
                          aria-label="Inactivar"
                          title="Inactivar"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EF4444] text-white hover:bg-[#DC2626]"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
                })
              )}
            </div>

            {filtered.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-600">
                  Mostrando {firstVisibleRow} - {lastVisibleRow} de {filtered.length}
                </p>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setExamPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage <= 1}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>

                  {pageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setExamPage(pageNumber)}
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                        pageNumber === currentPage
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setExamPage((value) => Math.min(totalPages, value + 1))}
                    disabled={currentPage >= totalPages}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            ) : null}

          </section>

          {showUploadModal ? (
            <ModalShell title="Subir examen con Excel" onClose={() => setShowUploadModal(false)}>
              <form onSubmit={onUploadExam} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-800">Nombre del examen</label>
                  <input
                    value={uploadExamName}
                    onChange={(event) => setUploadExamName(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    placeholder="Ejemplo: Banco parcial 1"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-800">Archivo Excel (.xlsx/.xls)</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(event) => setUploadExamFile(event.target.files?.[0] ?? null)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={uploadingExam}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                  >
                    {uploadingExam ? "Subiendo..." : "Confirmar subida"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showFormatModal ? (
            <ModalShell title="Formato de Excel requerido" onClose={() => setShowFormatModal(false)}>
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  El archivo debe tener los encabezados exactos. Puedes usar el boton &quot;Descargar formato&quot; para obtener
                  la plantilla oficial.
                </p>
                <div className="overflow-auto rounded-lg border border-slate-200">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        {["pregunta", "tipo", "opcion_a", "opcion_b", "opcion_c", "opcion_d", "respuesta_correcta", "explicacion", "puntaje", "temporizador_segundos", "tiempo_revision_segundos", "cronometro_segundos", "temporizador"].map((header) => (
                          <th key={header} className="border-b border-slate-200 px-2 py-2 text-left font-semibold">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      <tr className="bg-white">
                        <td className="border-b border-slate-100 px-2 py-2">Capital de Peru?</td>
                        <td className="border-b border-slate-100 px-2 py-2">seleccion</td>
                        <td className="border-b border-slate-100 px-2 py-2">Lima</td>
                        <td className="border-b border-slate-100 px-2 py-2">Cusco</td>
                        <td className="border-b border-slate-100 px-2 py-2">Piura</td>
                        <td className="border-b border-slate-100 px-2 py-2">Arequipa</td>
                        <td className="border-b border-slate-100 px-2 py-2">Lima</td>
                        <td className="border-b border-slate-100 px-2 py-2">Lima es la capital del Peru</td>
                        <td className="border-b border-slate-100 px-2 py-2">5</td>
                        <td className="border-b border-slate-100 px-2 py-2">30</td>
                        <td className="border-b border-slate-100 px-2 py-2">10</td>
                        <td className="border-b border-slate-100 px-2 py-2">0</td>
                        <td className="border-b border-slate-100 px-2 py-2">si</td>
                      </tr>
                      <tr className="bg-slate-50">
                        <td className="px-2 py-2">Define algoritmo</td>
                        <td className="px-2 py-2">escrita</td>
                        <td className="px-2 py-2">-</td>
                        <td className="px-2 py-2">-</td>
                        <td className="px-2 py-2">-</td>
                        <td className="px-2 py-2">-</td>
                        <td className="px-2 py-2">Conjunto de pasos para resolver un problema</td>
                        <td className="px-2 py-2">Un algoritmo es una serie de pasos ordenados</td>
                        <td className="px-2 py-2">10</td>
                        <td className="px-2 py-2">120</td>
                        <td className="px-2 py-2">15</td>
                        <td className="px-2 py-2">0</td>
                        <td className="px-2 py-2">si</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>`tipo`: usa `seleccion` o `escrita`.</li>
                  <li>`respuesta_correcta` en seleccion admite texto de opcion o `A/B/C/D` y `1/2/3/4`.</li>
                  <li>`temporizador` acepta `si/no`, `1/0`, `true/false`.</li>
                </ul>
              </div>
            </ModalShell>
          ) : null}

          {showManageModal && selectedExam ? (
            <ModalShell title={`Gestionar preguntas: ${selectedExam.name}`} onClose={() => setShowManageModal(false)}>
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                <form onSubmit={onSaveManualQuestion} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold text-slate-800">
                    {editingQuestionId == null ? "Crear pregunta manual" : `Editar pregunta #${editingQuestionId}`}
                  </h4>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Pregunta</label>
                    <textarea
                      value={manualQuestionForm.questionText}
                      onChange={(event) =>
                        setManualQuestionForm((prev) => ({ ...prev, questionText: event.target.value }))
                      }
                      className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                      placeholder="Escribe la pregunta..."
                      required
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
                      <select
                        value={manualQuestionForm.questionType}
                        onChange={(event) =>
                          setManualQuestionForm((prev) => ({
                            ...prev,
                            questionType: event.target.value as "multiple_choice" | "written",
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                      >
                        <option value="multiple_choice">Seleccion multiple</option>
                        <option value="written">Escrita</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Puntaje</label>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={manualQuestionForm.points}
                        onChange={(event) => setManualQuestionForm((prev) => ({ ...prev, points: event.target.value }))}
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Temporizador (segundos)</label>
                      <input
                        type="number"
                        min={1}
                        max={86400}
                        value={manualQuestionForm.temporizadorSegundos}
                        onChange={(event) =>
                          setManualQuestionForm((prev) => ({ ...prev, temporizadorSegundos: event.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Tiempo revision (segundos)</label>
                      <input
                        type="number"
                        min={1}
                        max={3600}
                        value={manualQuestionForm.reviewSeconds}
                        onChange={(event) =>
                          setManualQuestionForm((prev) => ({ ...prev, reviewSeconds: event.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                        required
                      />
                    </div>
                    <label className="grid min-h-[42px] grid-cols-[auto,1fr] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-tight text-slate-700">
                      <input
                        type="checkbox"
                        checked={manualQuestionForm.timerEnabled}
                        onChange={(event) =>
                          setManualQuestionForm((prev) => ({ ...prev, timerEnabled: event.target.checked }))
                        }
                        className="shrink-0"
                      />
                      <span className="min-w-0 break-words">Activar temporizador</span>
                    </label>
                  </div>
                  <p className="-mt-1 text-[11px] text-slate-500">Tiempo revision solo se usa en repaso grupal.</p>

                  {manualQuestionForm.questionType === "multiple_choice" ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={manualQuestionForm.optionA}
                          onChange={(event) => setManualQuestionForm((prev) => ({ ...prev, optionA: event.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          placeholder="Opcion A"
                          required
                        />
                        <input
                          value={manualQuestionForm.optionB}
                          onChange={(event) => setManualQuestionForm((prev) => ({ ...prev, optionB: event.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          placeholder="Opcion B"
                          required
                        />
                        <input
                          value={manualQuestionForm.optionC}
                          onChange={(event) => setManualQuestionForm((prev) => ({ ...prev, optionC: event.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          placeholder="Opcion C"
                        />
                        <input
                          value={manualQuestionForm.optionD}
                          onChange={(event) => setManualQuestionForm((prev) => ({ ...prev, optionD: event.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                          placeholder="Opcion D"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Opcion correcta</label>
                        <select
                          value={manualQuestionForm.correctOption}
                          onChange={(event) =>
                            setManualQuestionForm((prev) => ({
                              ...prev,
                              correctOption: event.target.value as "a" | "b" | "c" | "d",
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                        >
                          <option value="a">A</option>
                          <option value="b">B</option>
                          <option value="c">C</option>
                          <option value="d">D</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Respuesta correcta</label>
                      <input
                        value={manualQuestionForm.correctAnswer}
                        onChange={(event) =>
                          setManualQuestionForm((prev) => ({ ...prev, correctAnswer: event.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                        placeholder="Respuesta esperada"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Explicacion (opcional)</label>
                    <textarea
                      value={manualQuestionForm.explanation}
                      onChange={(event) =>
                        setManualQuestionForm((prev) => ({ ...prev, explanation: event.target.value }))
                      }
                      className="min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                      placeholder="Explicacion de la respuesta"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    {editingQuestionId != null ? (
                      <button
                        type="button"
                        onClick={onCancelManualQuestionEdit}
                        className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Cancelar edicion
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={savingManualQuestion}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                    >
                      {savingManualQuestion
                        ? editingQuestionId != null
                          ? "Actualizando..."
                          : "Guardando..."
                        : editingQuestionId != null
                          ? "Actualizar pregunta"
                          : "Guardar pregunta"}
                    </button>
                  </div>
                </form>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">Preguntas registradas</h4>
                    <select
                      value={manualQuestionOrder}
                      onChange={(event) => setManualQuestionOrder(event.target.value as "newest" | "oldest")}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="newest">Nuevas primero</option>
                      <option value="oldest">Antiguas primero</option>
                    </select>
                  </div>

                  {managedExamQuestions.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Este examen aun no tiene preguntas.
                    </p>
                  ) : (
                    <ul className="max-h-[58vh] space-y-2 overflow-auto pr-1">
                      {([...managedExamQuestions]
                        .sort((a, b) =>
                          manualQuestionOrder === "newest" ? b.id - a.id : a.id - b.id,
                        ))
                        .map((question) => (
                          <li key={question.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  #{question.id} {question.questionText}
                                </p>
                                <p className="text-xs text-slate-600">
                                  {questionTypeLabel(question.questionType)} | Puntaje: {question.points ?? 0} |
                                  Temporizador: {question.temporizadorSegundos ?? 0}s | Revision: {question.reviewSeconds ?? 10}s
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => onEditManualQuestion(question)}
                                className="rounded-md border border-blue-400 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                              >
                                Editar
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            </ModalShell>
          ) : null}

          {showGroupSettingsModal && selectedExam ? (
            <ModalShell
              title={`Configuracion repaso grupal: ${selectedExam.name}`}
              onClose={() => setShowGroupSettingsModal(false)}
            >
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Verificacion y explicacion</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_feedback_mode"
                      value="with_feedback"
                      checked={practiceFeedbackMode === "with_feedback"}
                      onChange={(event) => setPracticeFeedbackMode(event.target.value as PracticeFeedbackMode)}
                    />
                    Mostrar verificacion y explicacion en cada pregunta
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_feedback_mode"
                      value="without_feedback"
                      checked={practiceFeedbackMode === "without_feedback"}
                      onChange={(event) => setPracticeFeedbackMode(event.target.value as PracticeFeedbackMode)}
                    />
                    Avanzar directo sin verificacion inmediata
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Orden de preguntas</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_order_mode"
                      value="ordered"
                      checked={practiceOrderMode === "ordered"}
                      onChange={(event) => setPracticeOrderMode(event.target.value as PracticeOrderMode)}
                    />
                    En orden
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_order_mode"
                      value="random"
                      checked={practiceOrderMode === "random"}
                      onChange={(event) => setPracticeOrderMode(event.target.value as PracticeOrderMode)}
                    />
                    Aleatorio
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Progreso</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_progress_mode"
                      value="repeat_until_correct"
                      checked={practiceProgressMode === "repeat_until_correct"}
                      onChange={(event) => setPracticeProgressMode(event.target.value as PracticeProgressMode)}
                    />
                    Repetir hasta responder correctamente
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_progress_mode"
                      value="allow_incorrect_pass"
                      checked={practiceProgressMode === "allow_incorrect_pass"}
                      onChange={(event) => setPracticeProgressMode(event.target.value as PracticeProgressMode)}
                    />
                    Permitir avanzar aunque sea incorrecta
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Visibilidad del examen</p>
                  <select
                    value={practiceExamVisibility}
                    onChange={(event) =>
                      setPracticeExamVisibility(event.target.value === "public" ? "public" : "private")
                    }
                    disabled={(selectedExam.ownerUserId ?? 0) !== (user?.id ?? 0)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad] disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value="private">Privado (solo por enlace/permisos)</option>
                    <option value="public">Publico (visible en busqueda general)</option>
                  </select>
                  {(selectedExam.ownerUserId ?? 0) !== (user?.id ?? 0) ? (
                    <p className="mt-1 text-xs text-slate-500">Solo el propietario puede cambiar la visibilidad.</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGroupSettingsModal(false)}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void onSaveGroupPracticeSettings()}
                  disabled={savingPracticeSettings}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                >
                  {savingPracticeSettings ? "Guardando..." : "Guardar configuracion grupal"}
                </button>
              </div>
            </ModalShell>
          ) : null}

          {showIndividualSettingsModal && selectedExam ? (
            <ModalShell
              title={`Configuracion repaso individual: ${selectedExam.name}`}
              onClose={() => setShowIndividualSettingsModal(false)}
            >
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Verificacion y explicacion</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_feedback_mode"
                      value="with_feedback"
                      checked={practiceFeedbackMode === "with_feedback"}
                      onChange={(event) => setPracticeFeedbackMode(event.target.value as PracticeFeedbackMode)}
                    />
                    Mostrar verificacion y explicacion en cada pregunta
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_feedback_mode"
                      value="without_feedback"
                      checked={practiceFeedbackMode === "without_feedback"}
                      onChange={(event) => setPracticeFeedbackMode(event.target.value as PracticeFeedbackMode)}
                    />
                    Avanzar directo sin verificacion inmediata
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Orden de preguntas</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_order_mode"
                      value="ordered"
                      checked={practiceOrderMode === "ordered"}
                      onChange={(event) => setPracticeOrderMode(event.target.value as PracticeOrderMode)}
                    />
                    En orden
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_order_mode"
                      value="random"
                      checked={practiceOrderMode === "random"}
                      onChange={(event) => setPracticeOrderMode(event.target.value as PracticeOrderMode)}
                    />
                    Aleatorio
                  </label>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">Progreso</p>
                  <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_progress_mode"
                      value="repeat_until_correct"
                      checked={practiceProgressMode === "repeat_until_correct"}
                      onChange={(event) => setPracticeProgressMode(event.target.value as PracticeProgressMode)}
                    />
                    Repetir hasta responder correctamente
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="individual_practice_progress_mode"
                      value="allow_incorrect_pass"
                      checked={practiceProgressMode === "allow_incorrect_pass"}
                      onChange={(event) => setPracticeProgressMode(event.target.value as PracticeProgressMode)}
                    />
                    Permitir avanzar aunque sea incorrecta
                  </label>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIndividualSettingsModal(false)}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void onSaveIndividualPracticeSettings()}
                  disabled={savingPracticeSettings}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-70"
                >
                  {savingPracticeSettings ? "Guardando..." : "Guardar configuracion individual"}
                </button>
              </div>
            </ModalShell>
          ) : null}

          {showPracticeModal && selectedExam ? (
            <ModalShell
              title={`${
                practiceIntent === "restart"
                  ? "Reiniciar repaso"
                  : hasOpenPracticeDraft(selectedExam.id)
                    ? "Continuar repaso"
                    : "Iniciar repaso"
              }: ${selectedExam.name}`}
              onClose={() => {
                setShowPracticeModal(false);
                setPracticeIntent("start");
                setPracticeStartMode("personal");
              }}
            >
              <p className="text-sm text-slate-700">
                {practiceIntent === "restart"
                  ? "Se cerrara el avance pendiente y empezaras desde la primera pregunta."
                  : (selectedExam.participantsCount ?? 1) > 1
                    ? "Hay varios participantes en este examen. Elige modo personal o grupal."
                    : "Se cargaran las preguntas activas y se abrira la ventana de repaso."}
              </p>

              {(() => {
                const selectedAccessRole = (
                  selectedExam.accessRole ?? ((selectedExam.ownerUserId ?? 0) === (user?.id ?? 0) ? "owner" : "viewer")
                ).toLowerCase();
                const selectedIsOwner = selectedAccessRole === "owner";
                const selectedCanStartGroup = selectedExam.canStartGroup ?? selectedIsOwner;
                const selectedGroupPracticeStatus = (selectedExam.groupPracticeStatus ?? "").toLowerCase();
                const selectedGroupSessionActive =
                  selectedGroupPracticeStatus === "waiting" || selectedGroupPracticeStatus === "active";
                const canChooseGroupPractice = Boolean(selectedCanStartGroup) || selectedGroupSessionActive;

                return (
                  <>

              {practiceIntent !== "restart" && (selectedExam.participantsCount ?? 1) > 1 ? (
                <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="practice_start_mode"
                      value="personal"
                      checked={practiceStartMode === "personal"}
                      onChange={() => setPracticeStartMode("personal")}
                    />
                    Repaso personal (tu propio avance)
                  </label>
                  {canChooseGroupPractice ? (
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="practice_start_mode"
                        value="group"
                        checked={practiceStartMode === "group"}
                        onChange={() => setPracticeStartMode("group")}
                      />
                      Repaso grupal (misma pregunta para todos, con espera por respuestas)
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPracticeModal(false);
                    setPracticeIntent("start");
                    setPracticeStartMode("personal");
                  }}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (practiceIntent !== "restart" && (selectedExam.participantsCount ?? 1) > 1 && practiceStartMode === "group") {
                      if (selectedCanStartGroup) {
                        if (selectedGroupSessionActive && selectedExam.groupPracticeSessionId != null) {
                          void onJoinGroupPractice(selectedExam);
                        } else {
                          void onCreateGroupPractice(selectedExam);
                        }
                      } else {
                        void onJoinGroupPractice(selectedExam);
                      }
                      return;
                    }
                    void onStartPractice(undefined, practiceIntent === "restart");
                  }}
                  disabled={startingPractice || groupPracticeLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                >
                  {startingPractice || groupPracticeLoading
                    ? practiceIntent === "restart"
                      ? "Reiniciando..."
                      : practiceStartMode === "group"
                        ? "Entrando..."
                        : "Iniciando..."
                    : practiceIntent === "restart"
                      ? "Reiniciar repaso"
                      : practiceStartMode === "group" && (selectedExam.participantsCount ?? 1) > 1
                        ? selectedIsOwner
                          ? "Iniciar repaso grupal"
                          : "Unirse repaso grupal"
                        : hasOpenPracticeDraft(selectedExam.id)
                          ? "Continuar repaso"
                          : "Comenzar repaso"}
                </button>
              </div>
                  </>
                );
              })()}
            </ModalShell>
          ) : null}

          {showPracticeRunnerModal && selectedExam ? null : null}

          {showRenameExamModal && renameExamTarget ? (
            <ModalShell
              title="Editar nombre del examen"
              onClose={() => {
                if (renamingExam) {
                  return;
                }
                setShowRenameExamModal(false);
                setRenameExamTarget(null);
              }}
            >
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveRenameExamName();
                }}
              >
                <div>
                  <p className="text-sm text-slate-700">Actualiza el nombre para identificar mejor este examen.</p>
                  <label htmlFor="rename-exam-name" className="mt-3 block text-sm font-semibold text-slate-700">
                    Nombre del examen
                  </label>
                  <input
                    id="rename-exam-name"
                    type="text"
                    value={renameExamNameDraft}
                    onChange={(event) => setRenameExamNameDraft(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    maxLength={160}
                    autoFocus
                    disabled={renamingExam}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (renamingExam) {
                        return;
                      }
                      setShowRenameExamModal(false);
                      setRenameExamTarget(null);
                    }}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={renamingExam}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={renamingExam}
                  >
                    {renamingExam ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}

          {showDeactivateModal && selectedExam ? (
            <ModalShell title="Confirmar inactivacion" onClose={() => setShowDeactivateModal(false)}>
              <p className="text-sm text-slate-700">
                Vas a inactivar el examen <span className="font-semibold">{selectedExam.name}</span>. Esta accion lo
                sacara de la lista activa.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeactivateModal(false)}
                  className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void onInactivateExam(selectedExam)}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  Inactivar
                </button>
              </div>
            </ModalShell>
          ) : null}
        </div>
      );
    }

    if (active === "salas") {
      const rooms = salasData;
      const selectedRoom = selectedSala;
      const normalizedSalaSearch = courseSearchQuery.trim().toLowerCase();
      const salasVisibilityFilterValue = salaVisibilityFilter;
      const salasMicFilter =
        courseProgressFilter === "with_mic" || courseProgressFilter === "without_mic"
          ? courseProgressFilter
          : "all";
      const salasScreenFilter =
        courseYearFilter === "with_screen" || courseYearFilter === "without_screen"
          ? courseYearFilter
          : "all";
      const filteredRooms = [...rooms]
        .filter((room) => {
          if (!normalizedSalaSearch) {
            return true;
          }
          return (room.code ?? "").toLowerCase().includes(normalizedSalaSearch);
        })
        .filter((room) => {
          if (salasVisibilityFilterValue === "public") {
            return room.visibility === "public";
          }
          if (salasVisibilityFilterValue === "private") {
            return room.visibility === "private";
          }
          return true;
        })
        .filter((room) => {
          const micOnCount = room.participants.filter((participant) => participant.micOn).length;
          if (salasMicFilter === "with_mic") {
            return micOnCount > 0;
          }
          if (salasMicFilter === "without_mic") {
            return micOnCount === 0;
          }
          return true;
        })
        .filter((room) => {
          const screenCount = room.participants.filter((participant) => participant.isScreenSharing).length;
          if (salasScreenFilter === "with_screen") {
            return screenCount > 0;
          }
          if (salasScreenFilter === "without_screen") {
            return screenCount === 0;
          }
          return true;
        })
        .sort((first, second) => {
          if (courseSortMode === "name_desc") {
            return second.name.localeCompare(first.name, "es", { sensitivity: "base" });
          }
          if (courseSortMode === "newest") {
            return second.participants.length - first.participants.length;
          }
          if (courseSortMode === "oldest") {
            return first.participants.length - second.participants.length;
          }
          return first.name.localeCompare(second.name, "es", { sensitivity: "base" });
        });

      if (!selectedRoom) {
        return (
          <div className="w-full space-y-4">
            <DataCard title="Salas">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">Panel de coordinacion grupal.</p>
                <button
                  type="button"
                  onClick={() => {
                    setNewSalaName("");
                    setNewSalaCode(buildUniqueSalaCode(salasData));
                    setNewSalaVisibility("public");
                    setNewSalaDescription("");
                    setNewSalaImageData(null);
                    setNewSalaImageName("");
                    setShowCreateSalaModal(true);
                  }}
                  className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                >
                  Crear sala
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={salasMicFilter}
                  onChange={(event) => setCourseProgressFilter(event.target.value)}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 outline-none focus:border-blue-500"
                >
                  <option value="all">Microfonos</option>
                  <option value="with_mic">Con microfono activo</option>
                  <option value="without_mic">Sin microfono activo</option>
                </select>
                <select
                  value={salasScreenFilter}
                  onChange={(event) => setCourseYearFilter(event.target.value)}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 outline-none focus:border-blue-500"
                >
                  <option value="all">Pantalla</option>
                  <option value="with_screen">Con pantalla compartida</option>
                  <option value="without_screen">Sin pantalla compartida</option>
                </select>

                <select
                  value={salasVisibilityFilterValue}
                  onChange={(event) => setSalaVisibilityFilter(event.target.value as "all" | "public" | "private")}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 outline-none focus:border-blue-500"
                >
                  <option value="all">Visibilidad</option>
                  <option value="public">Publicas</option>
                  <option value="private">Privadas</option>
                </select>

                <div className="flex min-w-[240px] flex-1 items-center rounded-lg border border-blue-300 bg-white">
                  <input
                    value={courseSearchQuery}
                    onChange={(event) => setCourseSearchQuery(event.target.value)}
                    placeholder="Buscar sala por codigo"
                    className="w-full bg-transparent px-3 py-2 text-sm text-slate-900 outline-none"
                  />
                  {courseSearchQuery.trim() ? (
                    <button
                      type="button"
                      onClick={() => setCourseSearchQuery("")}
                      className="px-2 text-slate-500 hover:text-slate-700"
                    >
                      x
                    </button>
                  ) : null}
                </div>

                <select
                  value={courseSortMode}
                  onChange={(event) =>
                    setCourseSortMode(event.target.value as "name_asc" | "name_desc" | "newest" | "oldest")
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                >
                  <option value="name_asc">Ordenar por nombre (A-Z)</option>
                  <option value="name_desc">Ordenar por nombre (Z-A)</option>
                  <option value="newest">Mas participantes</option>
                  <option value="oldest">Menos participantes</option>
                </select>
              </div>

              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-base font-semibold text-[#004aad]">Salas en las que formas parte</p>
                <p className="mt-1 text-sm text-slate-700">Ingresa para chatear y coordinar con tu grupo.</p>
              </div>

              {salaMessage ? (
                <p
                  className={`mt-3 text-sm ${
                    salaMessageType === "error"
                      ? "text-rose-700"
                      : salaMessageType === "success"
                        ? "text-emerald-700"
                        : "text-blue-700"
                  }`}
                >
                  {salaMessage}
                </p>
              ) : null}

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {filteredRooms.map((room) => {
                  const membersCount = room.participants.length;
                  const micOnCount = room.participants.filter((participant) => participant.micOn).length;
                  const screenCount = room.participants.filter((participant) => participant.isScreenSharing).length;
                  return (
                    <article
                      key={room.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="h-[120px] w-[184px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                            {room.imageData?.trim() ? (
                              <img src={room.imageData} alt={`Portada de ${room.name}`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">
                                SIN IMAGEN
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenSala(room.id)}
                              className="text-left text-base font-semibold text-[#004aad] hover:underline"
                            >
                              {room.name}
                            </button>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                Codigo: {room.code || "SIN-CODIGO"}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  room.visibility === "public"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {room.visibility === "public" ? "Publica" : "Privada"}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-700">{room.description}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                Miembros: {membersCount}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                Mic ON: {micOnCount}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                Pantalla: {screenCount}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            onClick={() => setSalaActionMenuId((current) => (current === room.id ? null : room.id))}
                            aria-label={`Opciones de ${room.name}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-5 w-5"
                            >
                              <circle cx="12" cy="5" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="12" cy="19" r="1.8" />
                            </svg>
                          </button>
                          {salaActionMenuId === room.id ? (
                            <div className="absolute right-0 z-20 mt-2 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                              {room.canEdit !== false ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onOpenEditSala(room)}
                                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteSalaTarget(room);
                                      setSalaActionMenuId(null);
                                    }}
                                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50"
                                  >
                                    Eliminar
                                  </button>
                                </>
                              ) : null}
                              {room.canShare === true ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenShareModal("sala", room.id, room.name)}
                                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  Compartir
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
                {filteredRooms.length === 0 ? (
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 lg:col-span-2">
                    No se encontraron salas con los filtros aplicados.
                  </article>
                ) : null}
              </div>
            </DataCard>

            {showCreateSalaModal ? (
              <ModalShell
                title="Crear sala"
                onClose={() => {
                  setShowCreateSalaModal(false);
                  setNewSalaName("");
                  setNewSalaCode("");
                  setNewSalaVisibility("public");
                  setNewSalaDescription("");
                  setNewSalaImageData(null);
                  setNewSalaImageName("");
                }}
              >
                <form onSubmit={onCreateSala} className="space-y-3">
                  <input
                    value={newSalaName}
                    onChange={(event) => setNewSalaName(event.target.value)}
                    placeholder="Nombre de la sala"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    required
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Codigo unico</label>
                      <input
                        value={newSalaCode}
                        onChange={(event) => setNewSalaCode(normalizeSalaCode(event.target.value))}
                        placeholder="SALA-123456"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Visibilidad</label>
                      <select
                        value={newSalaVisibility}
                        onChange={(event) => setNewSalaVisibility(event.target.value as "public" | "private")}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                      >
                        <option value="public">Publica</option>
                        <option value="private">Privada</option>
                      </select>
                    </div>
                  </div>
                  <textarea
                    value={newSalaDescription}
                    onChange={(event) => setNewSalaDescription(event.target.value)}
                    placeholder="Descripcion de la sala"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Imagen de sala (opcional)</label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={async (event) => {
                        const selectedFile = event.target.files?.[0];

                        if (!selectedFile) {
                          setNewSalaImageData(null);
                          setNewSalaImageName("");
                          return;
                        }

                        const maxBytes = 5 * 1024 * 1024;
                        if (selectedFile.size > maxBytes) {
                          setSalaFeedback("La imagen de la sala debe pesar maximo 5 MB.", "error");
                          setNewSalaImageData(null);
                          setNewSalaImageName("");
                          event.currentTarget.value = "";
                          return;
                        }

                        try {
                          const dataUrl = await fileToDataUrl(selectedFile);
                          setNewSalaImageData(dataUrl);
                          setNewSalaImageName(selectedFile.name);
                          setSalaFeedback("", "info");
                        } catch {
                          setSalaFeedback("No se pudo leer la imagen seleccionada.", "error");
                          setNewSalaImageData(null);
                          setNewSalaImageName("");
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                    />
                    {newSalaImageData ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="truncate text-xs text-slate-600">{newSalaImageName}</p>
                        <div className="mt-2 h-24 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <img src={newSalaImageData} alt="Vista previa de sala" className="h-full w-full object-cover" />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Puedes cargar una portada para identificar la sala.</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateSalaModal(false);
                        setNewSalaName("");
                        setNewSalaCode("");
                        setNewSalaVisibility("public");
                        setNewSalaDescription("");
                        setNewSalaImageData(null);
                        setNewSalaImageName("");
                      }}
                      className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                    >
                      Crear
                    </button>
                  </div>
                </form>
              </ModalShell>
            ) : null}

            {showEditSalaModal ? (
              <ModalShell
                title="Editar sala"
                onClose={() => {
                  setShowEditSalaModal(false);
                  setEditingSalaId(null);
                  setEditSalaName("");
                  setEditSalaCode("");
                  setEditSalaVisibility("public");
                  setEditSalaDescription("");
                  setEditSalaImageData(null);
                  setEditSalaImageName("");
                }}
              >
                <form onSubmit={onSaveSalaEdit} className="space-y-3">
                  <input
                    value={editSalaName}
                    onChange={(event) => setEditSalaName(event.target.value)}
                    placeholder="Nombre de la sala"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    required
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Codigo unico</label>
                      <input
                        value={editSalaCode}
                        onChange={(event) => setEditSalaCode(normalizeSalaCode(event.target.value))}
                        placeholder="SALA-123456"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Visibilidad</label>
                      <select
                        value={editSalaVisibility}
                        onChange={(event) => setEditSalaVisibility(event.target.value as "public" | "private")}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                      >
                        <option value="public">Publica</option>
                        <option value="private">Privada</option>
                      </select>
                    </div>
                  </div>
                  <textarea
                    value={editSalaDescription}
                    onChange={(event) => setEditSalaDescription(event.target.value)}
                    placeholder="Descripcion de la sala"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  />
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">Imagen de sala (opcional)</label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={async (event) => {
                        const selectedFile = event.target.files?.[0];

                        if (!selectedFile) {
                          setEditSalaImageData(null);
                          setEditSalaImageName("");
                          return;
                        }

                        const maxBytes = 5 * 1024 * 1024;
                        if (selectedFile.size > maxBytes) {
                          setSalaFeedback("La imagen de la sala debe pesar maximo 5 MB.", "error");
                          setEditSalaImageData(null);
                          setEditSalaImageName("");
                          event.currentTarget.value = "";
                          return;
                        }

                        try {
                          const dataUrl = await fileToDataUrl(selectedFile);
                          setEditSalaImageData(dataUrl);
                          setEditSalaImageName(selectedFile.name);
                          setSalaFeedback("", "info");
                        } catch {
                          setSalaFeedback("No se pudo leer la imagen seleccionada.", "error");
                          setEditSalaImageData(null);
                          setEditSalaImageName("");
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#003b88]"
                    />
                    {editSalaImageData ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="truncate text-xs text-slate-600">{editSalaImageName || "Imagen de sala"}</p>
                        <div className="mt-2 h-24 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <img src={editSalaImageData} alt="Vista previa de sala" className="h-full w-full object-cover" />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditSalaImageData(null);
                            setEditSalaImageName("");
                          }}
                          className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Quitar imagen
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Puedes cargar o reemplazar la portada de la sala.</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditSalaModal(false);
                        setEditingSalaId(null);
                        setEditSalaName("");
                        setEditSalaCode("");
                        setEditSalaVisibility("public");
                        setEditSalaDescription("");
                        setEditSalaImageData(null);
                        setEditSalaImageName("");
                      }}
                      className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                    >
                      Guardar cambios
                    </button>
                  </div>
                </form>
              </ModalShell>
            ) : null}

            {deleteSalaTarget ? (
              <ModalShell title="Eliminar sala" onClose={() => setDeleteSalaTarget(null)}>
                <p className="text-sm text-slate-700">
                  Vas a eliminar la sala <span className="font-semibold">{deleteSalaTarget.name}</span>. Esta accion no
                  se puede deshacer.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteSalaTarget(null)}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteSala}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                  >
                    Eliminar
                  </button>
                </div>
              </ModalShell>
            ) : null}
          </div>
        );
      }

      const micOnCount = selectedRoom.participants.filter((participant) => participant.micOn).length;
      const screenSharedBy = selectedRoom.participants.find((participant) => participant.isScreenSharing)?.name ?? null;
      const sharingParticipants = selectedRoom.participants.filter((participant) => participant.isScreenSharing);
      const mySalaParticipant =
        selectedRoom.participants.find((participant) => participant.name.trim().toLowerCase() === "tu") ?? null;
      const isMySalaScreenSharing = Boolean(mySalaParticipant?.isScreenSharing);
      const pinnedSharingParticipant =
        sharingParticipants.find((participant) => participant.id === salaPinnedScreenParticipantId) ??
        sharingParticipants[0] ??
        null;
      const maximizedSharingParticipant =
        sharingParticipants.find((participant) => participant.id === salaMaximizedScreenParticipantId) ?? null;
      const otherSharingParticipants =
        pinnedSharingParticipant == null
          ? sharingParticipants
          : sharingParticipants.filter((participant) => participant.id !== pinnedSharingParticipant.id);
      const pendingControlParticipant =
        selectedRoom.participants.find((participant) => participant.id === salaControlRequestTargetId) ?? null;
      const isPinnedControlPending =
        pinnedSharingParticipant != null &&
        salaControlRequestPending &&
        salaControlRequestTargetId === pinnedSharingParticipant.id;
      const isPinnedControlGranted =
        pinnedSharingParticipant != null && salaControlGrantedParticipantId === pinnedSharingParticipant.id;
      const isMaxControlGranted =
        maximizedSharingParticipant != null && salaControlGrantedParticipantId === maximizedSharingParticipant.id;
      const previewStyles = [
        "bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_45%,#334155_100%)]",
        "bg-[linear-gradient(135deg,#1e3a8a_0%,#1d4ed8_45%,#2563eb_100%)]",
        "bg-[linear-gradient(135deg,#0f766e_0%,#0d9488_45%,#14b8a6_100%)]",
        "bg-[linear-gradient(135deg,#4c1d95_0%,#6d28d9_45%,#7c3aed_100%)]",
      ];
      const pinnedPreviewStyle =
        pinnedSharingParticipant != null
          ? previewStyles[pinnedSharingParticipant.id % previewStyles.length]
          : previewStyles[0];
      const maximizedPreviewStyle =
        maximizedSharingParticipant != null
          ? previewStyles[maximizedSharingParticipant.id % previewStyles.length]
          : previewStyles[0];

      return (
        <div className="w-full space-y-4">
          <DataCard title="Salas">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">Detalle de sala activa.</p>
              <button
                type="button"
                onClick={onBackToSalas}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Volver a salas
              </button>
            </div>

            {salaMessage ? (
              <p
                className={`mt-3 text-sm ${
                  salaMessageType === "error"
                    ? "text-rose-700"
                    : salaMessageType === "success"
                      ? "text-emerald-700"
                      : "text-blue-700"
                }`}
              >
                {salaMessage}
              </p>
            ) : null}

            <article className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="h-28 w-44 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {selectedRoom.imageData?.trim() ? (
                      <img src={selectedRoom.imageData} alt={`Portada de ${selectedRoom.name}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500">
                        SIN IMAGEN
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                  <p className="text-lg font-semibold text-[#004aad]">{selectedRoom.name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                      Codigo: {selectedRoom.code || "SIN-CODIGO"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        selectedRoom.visibility === "public"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {selectedRoom.visibility === "public" ? "Publica" : "Privada"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{selectedRoom.description}</p>
                  <p className="mt-2 text-sm font-semibold text-[#004aad]">
                    Pantalla compartida por: {screenSharedBy ?? "Nadie"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-emerald-700">Microfonos activos: {micOnCount}</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#004aad] px-3 py-1 text-xs font-semibold text-white">
                  {selectedRoom.participants.length} en linea
                </span>
              </div>
            </article>
          </DataCard>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-800">Pantallas compartidas</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMySalaScreenShare}
                  disabled={mySalaParticipant == null}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    isMySalaScreenSharing
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isMySalaScreenSharing ? "Dejar de compartir" : "Compartir pantalla"}
                </button>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#004aad]">
                  {sharingParticipants.length} activa{sharingParticipants.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={onToggleSalaSharedScreens}
                  aria-expanded={salasSharedScreensOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#004aad] hover:bg-blue-100"
                >
                  <span>{salasSharedScreensOpen ? "Ocultar" : "Mostrar"}</span>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-200 bg-white text-[11px] leading-none">
                    {salasSharedScreensOpen ? "-" : "+"}
                  </span>
                </button>
              </div>
            </div>

            {salasSharedScreensOpen ? (
              pinnedSharingParticipant ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div
                    ref={salaPinnedViewportRef}
                    className="relative h-[240px] overflow-hidden text-white sm:h-[280px] lg:h-[320px]"
                  >
                    <div
                      onMouseDown={onStartPinnedScreenDrag}
                      onTouchStart={onStartPinnedScreenTouch}
                      onMouseMove={(event) => onMoveSalaRemotePointer(event, "pinned")}
                      className={`absolute inset-0 ${pinnedPreviewStyle} transition-transform duration-200 ease-out ${
                        salaPinnedZoom > 1 ? "cursor-grab active:cursor-grabbing touch-none" : "cursor-default"
                      }`}
                      style={{
                        transform: `translate(${salaPinnedPanX}%, ${salaPinnedPanY}%) scale(${salaPinnedZoom})`,
                        transformOrigin: "center center",
                        userSelect: "none",
                      }}
                    >
                      <div className="absolute left-8 top-9 h-20 w-48 rounded-lg border border-white/30 bg-white/12" />
                      <div className="absolute right-8 top-14 h-16 w-32 rounded-lg border border-white/25 bg-white/10" />
                      <div className="absolute bottom-8 left-10 h-24 w-[52%] rounded-lg border border-white/25 bg-white/10" />
                      <div className="absolute bottom-8 right-10 h-10 w-24 rounded-lg border border-white/25 bg-white/10" />
                    </div>
                    <div className="absolute left-3 top-3 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold sm:text-xs">
                      Pantalla anclada
                    </div>
                    <div className="absolute left-3 top-10 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white sm:top-11 sm:text-xs">
                      Zoom {Math.round(salaPinnedZoom * 100)}%
                    </div>
                    <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onAdjustPinnedZoom(0.2)}
                        title="Acercar"
                        aria-label="Acercar pantalla compartida"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30 sm:h-9 sm:w-9"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="h-4 w-4 sm:h-4.5 sm:w-4.5"
                        >
                          <circle cx="11" cy="11" r="6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.2-4.2" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 8v6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 11h6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustPinnedZoom(-0.2)}
                        title="Reducir"
                        aria-label="Reducir zoom de pantalla compartida"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30 sm:h-9 sm:w-9"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="h-4 w-4 sm:h-4.5 sm:w-4.5"
                        >
                          <circle cx="11" cy="11" r="6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.2-4.2" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 11h6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSalaMaximizedScreen(pinnedSharingParticipant.id)}
                        title="Maximizar pantalla"
                        aria-label="Maximizar pantalla compartida"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30 sm:h-9 sm:w-9"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="h-4 w-4 sm:h-4.5 sm:w-4.5"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H3v6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7 7" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v6h-6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-7-7" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 3l-7 7" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 15v6h6" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 21l7-7" />
                        </svg>
                      </button>
                    </div>
                    <div className="absolute right-3 top-[3.1rem] z-10 rounded-lg border border-white/35 bg-black/35 p-1.5 sm:top-14">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onAdjustPinnedZoom(0.2)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-xs font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdjustPinnedZoom(-0.2)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-xs font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          -
                        </button>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        <span />
                        <button
                          type="button"
                          onClick={() => onMovePinnedScreen(0, -6)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          U
                        </button>
                        <span />
                        <button
                          type="button"
                          onClick={() => onMovePinnedScreen(-6, 0)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          L
                        </button>
                        <button
                          type="button"
                          onClick={onResetPinnedScreen}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          0
                        </button>
                        <button
                          type="button"
                          onClick={() => onMovePinnedScreen(6, 0)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          R
                        </button>
                        <span />
                        <button
                          type="button"
                          onClick={() => onMovePinnedScreen(0, 6)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30 sm:h-7 sm:w-7"
                        >
                          D
                        </button>
                        <span />
                      </div>
                    </div>
                    {isPinnedControlGranted ? (
                      <div
                        className="pointer-events-none absolute z-20"
                        style={{
                          left: `${salaRemotePointerX}%`,
                          top: `${salaRemotePointerY}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <div className="h-3.5 w-3.5 rounded-full bg-emerald-400 shadow-lg ring-2 ring-white" />
                        <span className="mt-1 inline-flex rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
                          Tu cursor
                        </span>
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-4">
                      <p className="text-xs uppercase tracking-wide text-blue-100">Compartiendo</p>
                      <p className="text-xl font-semibold leading-tight">{pinnedSharingParticipant.name}</p>
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Control remoto (simulado)</p>
                    {isPinnedControlGranted ? (
                      <>
                        <p className="text-xs text-emerald-700">
                          Control activo sobre la pantalla de {pinnedSharingParticipant.name}. Puedes mover mouse y enviar texto.
                        </p>
                        <form onSubmit={onSubmitSalaRemoteInput} className="flex flex-wrap gap-2">
                          <input
                            value={salaRemoteInputDraft}
                            onChange={(event) => setSalaRemoteInputDraft(event.target.value)}
                            placeholder="Escribe una accion remota..."
                            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-[#004aad] px-3 py-2 text-xs font-semibold text-white hover:bg-[#003b88]"
                          >
                            Enviar
                          </button>
                          <button
                            type="button"
                            onClick={onReleaseSalaControl}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Liberar control
                          </button>
                        </form>
                        {salaRemoteLastCommand ? (
                          <p className="text-[11px] text-slate-600">Ultimo comando enviado: {salaRemoteLastCommand}</p>
                        ) : null}
                      </>
                    ) : isPinnedControlPending ? (
                      <>
                        <p className="text-xs text-amber-700">
                          Solicitud enviada a {pendingControlParticipant?.name ?? pinnedSharingParticipant.name}. Esperando respuesta del anfitrion.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={onApproveSalaControlRequest}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            Aceptar (simulado)
                          </button>
                          <button
                            type="button"
                            onClick={onRejectSalaControlRequest}
                            className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Rechazar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {salaControlGrantedParticipantId != null ? (
                          <p className="text-xs text-slate-600">
                            Control activo en otra pantalla. Fijala como anclada para manejarla o libera el control actual.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onRequestSalaControl(pinnedSharingParticipant.id)}
                            className="rounded-lg bg-[#004aad] px-3 py-2 text-xs font-semibold text-white hover:bg-[#003b88]"
                          >
                            Solicitar control
                          </button>
                          {salaControlGrantedParticipantId != null ? (
                            <button
                              type="button"
                              onClick={onReleaseSalaControl}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Liberar control
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Otras pantallas</p>
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:max-h-[320px] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
                    {otherSharingParticipants.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-slate-500">No hay otras pantallas activas.</p>
                    ) : null}
                    {otherSharingParticipants.map((participant, index) => {
                      const style = previewStyles[(participant.id + index) % previewStyles.length];
                      const isPinned = pinnedSharingParticipant.id === participant.id;
                      return (
                        <button
                          key={participant.id}
                          type="button"
                          onClick={() => setSalaPinnedScreenParticipantId(participant.id)}
                            className={`group min-w-[140px] rounded-lg border p-2 text-left transition sm:min-w-[170px] lg:min-w-0 ${
                            isPinned
                              ? "border-[#004aad] bg-blue-50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                          }`}
                        >
                          <div className={`h-16 w-full rounded-md ${style}`} />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-slate-800">{participant.name}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                isPinned ? "bg-[#004aad] text-white" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {isPinned ? "Fijada" : "Fijar"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              ) : (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Nadie esta compartiendo pantalla en este momento.
                </p>
              )
            ) : null}
          </article>

          {maximizedSharingParticipant ? (
            <ModalShell
              title={`Pantalla compartida - ${maximizedSharingParticipant.name}`}
              onClose={() => setSalaMaximizedScreenParticipantId(null)}
            >
              <div className="space-y-3">
                <div ref={salaMaxViewportRef} className="relative h-[70vh] overflow-hidden rounded-xl border border-slate-200">
                  <div
                    onMouseDown={onStartMaxScreenDrag}
                    onTouchStart={onStartMaxScreenTouch}
                    onMouseMove={(event) => onMoveSalaRemotePointer(event, "max")}
                    className={`absolute inset-0 ${maximizedPreviewStyle} transition-transform duration-200 ease-out ${
                      salaMaxZoom > 1 ? "cursor-grab active:cursor-grabbing touch-none" : "cursor-default"
                    }`}
                    style={{
                      transform: `translate(${salaMaxPanX}%, ${salaMaxPanY}%) scale(${salaMaxZoom})`,
                      transformOrigin: "center center",
                      userSelect: "none",
                    }}
                  >
                    <div className="absolute left-12 top-12 h-28 w-64 rounded-xl border border-white/30 bg-white/12" />
                    <div className="absolute right-12 top-16 h-24 w-52 rounded-xl border border-white/30 bg-white/10" />
                    <div className="absolute bottom-14 left-14 h-36 w-[58%] rounded-xl border border-white/25 bg-white/10" />
                    <div className="absolute bottom-16 right-12 h-16 w-36 rounded-lg border border-white/25 bg-white/10" />
                  </div>
                  <div className="absolute left-3 top-3 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white">
                    Vista ampliada
                  </div>
                  <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onAdjustMaxZoom(0.2)}
                      title="Acercar"
                      aria-label="Acercar en vista maximizada"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <circle cx="11" cy="11" r="6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.2-4.2" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 8v6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 11h6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAdjustMaxZoom(-0.2)}
                      title="Reducir"
                      aria-label="Reducir en vista maximizada"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white hover:bg-white/30"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <circle cx="11" cy="11" r="6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.2-4.2" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 11h6" />
                      </svg>
                    </button>
                    <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white">
                      En vivo (simulado)
                    </span>
                  </div>
                  <div className="absolute left-3 top-11 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white">
                    Zoom {Math.round(salaMaxZoom * 100)}%
                  </div>
                  <div className="absolute right-3 top-11 z-10 rounded-lg border border-white/35 bg-black/35 p-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onAdjustMaxZoom(0.2)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-sm font-semibold text-white hover:bg-white/30"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustMaxZoom(-0.2)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-sm font-semibold text-white hover:bg-white/30"
                      >
                        -
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      <span />
                      <button
                        type="button"
                        onClick={() => onMoveMaxScreen(0, -6)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30"
                      >
                        U
                      </button>
                      <span />
                      <button
                        type="button"
                        onClick={() => onMoveMaxScreen(-6, 0)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30"
                      >
                        L
                      </button>
                      <button
                        type="button"
                        onClick={onResetMaxScreen}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveMaxScreen(6, 0)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30"
                      >
                        R
                      </button>
                      <span />
                      <button
                        type="button"
                        onClick={() => onMoveMaxScreen(0, 6)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/35 bg-white/20 text-[10px] font-semibold text-white hover:bg-white/30"
                      >
                        D
                      </button>
                      <span />
                    </div>
                  </div>
                  {isMaxControlGranted ? (
                    <div
                      className="pointer-events-none absolute z-20"
                      style={{
                        left: `${salaRemotePointerX}%`,
                        top: `${salaRemotePointerY}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <div className="h-4 w-4 rounded-full bg-emerald-400 shadow-lg ring-2 ring-white" />
                      <span className="mt-1 inline-flex rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Tu cursor
                      </span>
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-4">
                    <p className="text-xs uppercase tracking-wide text-blue-100">Compartiendo pantalla</p>
                    <p className="text-2xl font-semibold text-white">{maximizedSharingParticipant.name}</p>
                  </div>
                </div>
                {isMaxControlGranted ? (
                  <p className="text-xs text-emerald-700">
                    Control remoto activo. Arrastra el mouse sobre la vista para mover el puntero.
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSalaMaximizedScreenParticipantId(null)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}

          <section
            className={`grid gap-4 xl:grid-cols-[345px_minmax(0,1fr)] ${
              salasParticipantsOpen && salasChatOpen ? "items-stretch" : "items-start"
            }`}
          >
            <article
              className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${
                salasParticipantsOpen && salasChatOpen ? "h-full" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                  Participantes <span className="ml-2 text-slate-600">{selectedRoom.participants.length}</span>
                </p>
                <button
                  type="button"
                  onClick={onToggleSalaParticipants}
                  aria-expanded={salasParticipantsOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#004aad] hover:bg-blue-100"
                >
                  <span>{salasParticipantsOpen ? "Ocultar" : "Mostrar"}</span>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-200 bg-white text-[11px] leading-none">
                    {salasParticipantsOpen ? "-" : "+"}
                  </span>
                </button>
              </div>

              {salasParticipantsOpen ? (
                <div className="mt-3 max-h-[710px] space-y-2 overflow-y-auto pr-1">
                  {selectedRoom.participants.map((participant) => (
                    <div
                      key={participant.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-3.5 w-3.5"
                          >
                            <circle cx="12" cy="8" r="4" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0 1 14 0" />
                          </svg>
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-900">{participant.name}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            participant.micOn ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-800"
                          }`}
                        >
                          {participant.micOn ? "MIC ON" : "MIC OFF"}
                        </span>
                        {participant.isScreenSharing ? (
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-[#004aad]">
                            PANTALLA
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>

            <article
              className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${
                salasParticipantsOpen && salasChatOpen ? "h-full" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                  Chat de la sala <span className="ml-2 text-slate-600">{selectedRoom.messages.length}</span>
                </p>
                <button
                  type="button"
                  onClick={onToggleSalaChat}
                  aria-expanded={salasChatOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#004aad] hover:bg-blue-100"
                >
                  <span>{salasChatOpen ? "Ocultar" : "Mostrar"}</span>
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-blue-200 bg-white text-[11px] leading-none">
                    {salasChatOpen ? "-" : "+"}
                  </span>
                </button>
              </div>

              {salasChatOpen ? (
                <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1">
                  <article className="min-h-[280px] flex-1 max-h-[76vh] space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {selectedRoom.messages.length === 0 ? (
                      <p className="text-sm text-slate-500">Aun no hay mensajes en esta sala.</p>
                    ) : null}
                  {selectedRoom.messages.map((message) => (
                    <div key={message.id} className={`flex ${message.isCurrentUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2.5 ${
                          message.isCurrentUser ? "bg-[#004aad] text-white" : "bg-slate-200 text-slate-900"
                        }`}
                      >
                        <p className={`text-xs font-semibold ${message.isCurrentUser ? "text-blue-100" : "text-slate-600"}`}>
                          {message.sender}
                        </p>
                        <p className="mt-1 text-sm leading-snug">{message.content}</p>
                      </div>
                    </div>
                  ))}
                </article>

                  <form onSubmit={onSendSalaMessage} className="mt-auto flex items-center gap-2 pt-0.5">
                  <input
                    value={salaDraftMessage}
                    onChange={(event) => setSalaDraftMessage(event.target.value)}
                    placeholder="Escribe en la sala"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#004aad] text-white hover:bg-[#003b88]"
                    aria-label="Enviar mensaje"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-5 w-5"
                    >
                      <path d="M3.4 20.1 21 12 3.4 3.9 3.3 10.5l10.1 1.5-10.1 1.5z" />
                    </svg>
                  </button>
                </form>
                </div>
              ) : null}
            </article>
          </section>
        </div>
      );
    }

    if (active === "notificaciones") {
      const notifications = (Array.isArray(payload) ? payload : []).filter((item) =>
        isShareNotificationPayload(item),
      ) as ShareNotificationItem[];

      return (
        <div className="w-full space-y-4">
          <DataCard title="Notificaciones">
            <p className="text-sm text-slate-600">Aqui recibes recursos compartidos (examenes, cursos, horarios o salas).</p>

            <div className="mt-3 space-y-2">
              {notifications.length === 0 ? (
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No tienes notificaciones por ahora.
                </article>
              ) : (
                notifications.map((notification) => {
                  const createdAtText = formatExamCreatedAt(notification.createdAt, undefined);
                  const isRead = !!notification.readAt;
                  const invitationStatus = normalizeInvitationStatus(notification.invitationStatus);
                  const requiresInvitationResponse = notificationRequiresInvitationResponse(notification.resourceType);
                  const isPendingInvite = requiresInvitationResponse && invitationStatus === "pending";
                  const isAcceptedInvite = requiresInvitationResponse && invitationStatus === "accepted";
                  const isRejectedInvite = requiresInvitationResponse && invitationStatus === "rejected";
                  const shareUrl =
                    notification.token && notification.token.trim()
                      ? buildShareAccessUrl(notification.token.trim())
                      : "";
                  const canOpenResource = requiresInvitationResponse ? invitationStatus === "accepted" : !!shareUrl;
                  const resourceTypeText =
                    notification.resourceType === "exam"
                      ? "Examen"
                      : notification.resourceType === "course"
                        ? "Curso"
                        : notification.resourceType === "schedule"
                          ? "Horario"
                        : notification.resourceType === "sala"
                          ? "Sala"
                          : "Recurso";
                  return (
                    <article
                      key={notification.id}
                      className={`rounded-xl border p-4 ${
                        isRead ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">
                          {resourceTypeText}: {notification.resourceName?.trim() || "Sin nombre"}
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              isRead ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {isRead ? "Leida" : "Nueva"}
                          </span>
                          {requiresInvitationResponse ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                isPendingInvite
                                  ? "bg-amber-100 text-amber-700"
                                  : isRejectedInvite
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {isPendingInvite ? "Pendiente" : isRejectedInvite ? "Rechazada" : "Aceptada"}
                            </span>
                          ) : null}
                          <span className="text-xs text-slate-500">{createdAtText}</span>
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {notification.message?.trim() ||
                          `${notification.senderName?.trim() || "Usuario"} te compartio ${resourceTypeText.toLowerCase()}.`}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Remitente: {notification.senderName?.trim() || "Usuario"}{" "}
                        {notification.senderUsername?.trim() ? `(@${notification.senderUsername.trim()})` : ""}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {isPendingInvite ? (
                          <>
                            <button
                              type="button"
                              disabled={notificationActionLoadingId === notification.id}
                              onClick={() => void onRejectNotificationInvitation(notification)}
                              className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                            >
                              {notificationActionLoadingId === notification.id ? "Procesando..." : "Rechazar"}
                            </button>
                            <button
                              type="button"
                              disabled={notificationActionLoadingId === notification.id}
                              onClick={() => void onAcceptNotificationInvitation(notification)}
                              className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-60"
                            >
                              {notificationActionLoadingId === notification.id ? "Aceptando..." : "Aceptar"}
                            </button>
                          </>
                        ) : canOpenResource ? (
                          <button
                            type="button"
                            onClick={() => void onOpenNotificationResource(notification)}
                            className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                          >
                            {isAcceptedInvite && notification.resourceType === "exam"
                              ? "Ver examen"
                              : isAcceptedInvite && notification.resourceType === "schedule"
                                ? "Ver horario"
                                : "Abrir"}
                          </button>
                        ) : null}
                        {shareUrl && (!requiresInvitationResponse || invitationStatus === "accepted") ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                if (typeof navigator !== "undefined" && navigator.clipboard) {
                                  await navigator.clipboard.writeText(shareUrl);
                                }
                              } catch {
                                setError("No se pudo copiar el enlace de notificacion.");
                              }
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Copiar enlace
                          </button>
                        ) : null}
                        {!isRead ? (
                          <button
                            type="button"
                            disabled={notificationActionLoadingId === notification.id}
                            onClick={() => void onMarkNotificationAsRead(notification)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          >
                            {notificationActionLoadingId === notification.id ? "Marcando..." : "Marcar leida"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </DataCard>
        </div>
      );
    }

    if (active === "horarios") {
      const dayOrder = (day: ScheduleDayKey) => {
        if (day === "all") {
          return 0;
        }
        const index = SCHEDULE_DAY_OPTIONS.findIndex((item) => item.key === day);
        return index >= 0 ? index + 1 : 99;
      };
      const sortedScheduleActivities = [...scheduleActivities].sort((first, second) => {
        const byDay = dayOrder(first.day) - dayOrder(second.day);
        if (byDay !== 0) {
          return byDay;
        }
        const byStart = timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        if (byStart !== 0) {
          return byStart;
        }
        return first.title.localeCompare(second.title, "es", { sensitivity: "base" });
      });
      type ScheduleGridCell = {
        skip: boolean;
        rowSpan: number;
        activities: ScheduleActivity[];
      };
      const scheduleGridByDay = scheduleWeekDays.reduce((accumulator, day) => {
        const startsByRow: Array<Array<{ activity: ScheduleActivity; rowSpan: number }>> = Array.from(
          { length: scheduleSlots.length },
          () => [],
        );

        sortedScheduleActivities.forEach((activity) => {
          if (activity.day !== "all" && activity.day !== day.key) {
            return;
          }
          const startMinutes = timeToMinutes(activity.startTime);
          const endMinutes = timeToMinutes(activity.endTime);
          if (endMinutes <= startMinutes) {
            return;
          }

          const coveredIndexes = scheduleSlots
            .map((slot, index) => ({
              index,
              overlaps: startMinutes < slot.end && endMinutes > slot.start,
            }))
            .filter((entry) => entry.overlaps)
            .map((entry) => entry.index);
          if (coveredIndexes.length === 0) {
            return;
          }

          const startIndex = coveredIndexes[0];
          const endIndex = coveredIndexes[coveredIndexes.length - 1];

          const rowSpan = Math.max(1, endIndex - startIndex + 1);
          startsByRow[startIndex].push({ activity, rowSpan });
        });

        const dayCells: ScheduleGridCell[] = Array.from({ length: scheduleSlots.length }, () => ({
          skip: false,
          rowSpan: 1,
          activities: [],
        }));

        let rowsToSkip = 0;
        for (let rowIndex = 0; rowIndex < scheduleSlots.length; rowIndex += 1) {
          if (rowsToSkip > 0) {
            dayCells[rowIndex] = { skip: true, rowSpan: 1, activities: [] };
            rowsToSkip -= 1;
            continue;
          }

          const starts = startsByRow[rowIndex];
          if (!starts || starts.length === 0) {
            dayCells[rowIndex] = { skip: false, rowSpan: 1, activities: [] };
            continue;
          }

          const rowSpan = starts.reduce((maximum, entry) => Math.max(maximum, entry.rowSpan), 1);
          dayCells[rowIndex] = {
            skip: false,
            rowSpan,
            activities: starts.map((entry) => entry.activity),
          };
          rowsToSkip = rowSpan - 1;
        }

        accumulator[day.key] = dayCells;
        return accumulator;
      }, {} as Record<Exclude<ScheduleDayKey, "all">, ScheduleGridCell[]>);
      const scheduleFormFields = (
        <form onSubmit={onCreateScheduleActivity} className="space-y-2.5">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Nombre</label>
            <input
              value={scheduleFormTitle}
              onChange={(event) => setScheduleFormTitle(event.target.value)}
              placeholder="Ejemplo: Matematica I"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Descripcion</label>
            <textarea
              value={scheduleFormDescription}
              onChange={(event) => setScheduleFormDescription(event.target.value)}
              placeholder="Tema o detalle de la clase"
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Dia</label>
              <select
                value={scheduleFormDay}
                onChange={(event) => setScheduleFormDay(event.target.value as ScheduleDayKey)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
              >
                <option value="all">Toda la semana</option>
                {scheduleWeekDays.map((day) => (
                  <option key={day.key} value={day.key}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Color</label>
              <select
                value={scheduleFormColor}
                onChange={(event) => setScheduleFormColor(event.target.value as ScheduleColorKey)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
              >
                {SCHEDULE_COLOR_OPTIONS.map((colorOption) => (
                  <option key={colorOption.key} value={colorOption.key}>
                    {colorOption.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Hora inicio</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scheduleFormStartTime}
                  onChange={(event) => setScheduleFormStartTime(event.target.value)}
                  onBlur={(event) => {
                    const normalized = normalizeScheduleTimeFromForm(event.target.value, scheduleFormStartMeridiem);
                    if (!normalized) {
                      return;
                    }
                    const split = splitScheduleTimeForForm(normalized);
                    if (!split) {
                      return;
                    }
                    setScheduleFormStartTime(split.time);
                    setScheduleFormStartMeridiem(split.meridiem);
                  }}
                  placeholder="Ejemplo: 08:30"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <select
                  value={scheduleFormStartMeridiem}
                  onChange={(event) => setScheduleFormStartMeridiem(event.target.value as "AM" | "PM")}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Hora fin</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scheduleFormEndTime}
                  onChange={(event) => setScheduleFormEndTime(event.target.value)}
                  onBlur={(event) => {
                    const normalized = normalizeScheduleTimeFromForm(event.target.value, scheduleFormEndMeridiem);
                    if (!normalized) {
                      return;
                    }
                    const split = splitScheduleTimeForForm(normalized);
                    if (!split) {
                      return;
                    }
                    setScheduleFormEndTime(split.time);
                    setScheduleFormEndMeridiem(split.meridiem);
                  }}
                  placeholder="Ejemplo: 09:45"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                  required
                />
                <select
                  value={scheduleFormEndMeridiem}
                  onChange={(event) => setScheduleFormEndMeridiem(event.target.value as "AM" | "PM")}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">Formato sugerido: HH:mm y selecciona AM/PM al costado.</p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Ubicacion</label>
            <input
              value={scheduleFormLocation}
              onChange={(event) => setScheduleFormLocation(event.target.value)}
              placeholder="Aula o referencia"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingScheduleActivity}
              className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {savingScheduleActivity
                ? "Guardando..."
                : editingScheduleId != null
                  ? "Guardar cambios"
                  : "Guardar actividad"}
            </button>
          </div>
        </form>
      );
      return (
        <div className="w-full space-y-4">
          <DataCard title="Horarios">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleViewMode("weekly")}
                  className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition ${
                    scheduleViewMode === "weekly"
                      ? "border-[#004aad] bg-[#004aad] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Vista semanal
                </button>
                {scheduleCanEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingScheduleId(null);
                      setScheduleFormTitle("");
                      setScheduleFormDescription("");
                      setScheduleFormDay("monday");
                      setScheduleFormStartTime("08:00");
                      setScheduleFormStartMeridiem("AM");
                      setScheduleFormEndTime("09:30");
                      setScheduleFormEndMeridiem("AM");
                      setScheduleFormLocation("");
                      setScheduleFormColor("blue");
                      setScheduleActionMenuId(null);
                      setShowCreateScheduleModal(true);
                    }}
                    className="rounded-lg bg-[#004aad] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#003b88]"
                  >
                    Nueva actividad
                  </button>
                ) : null}
                {scheduleCanShare && scheduleProfileId != null ? (
                  <button
                    type="button"
                    onClick={() => onOpenShareModal("schedule", scheduleProfileId, scheduleProfileName)}
                    className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    Compartir horario
                  </button>
                ) : null}
              </div>
              <div className="mx-auto w-full max-w-2xl">
                <label className="mb-1 block text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Seleccionar horario
                </label>
                <select
                  value={scheduleProfileSelectValue}
                  onChange={onSelectScheduleProfile}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                  disabled={scheduleProfiles.length === 0}
                >
                  {scheduleProfiles.length === 0 ? (
                    <option value="">Mi horario</option>
                  ) : (
                    scheduleProfiles.map((profile) => {
                      const isOwner = user?.id != null && profile.ownerUserId === user.id;
                      const roleLabel = (profile.accessRole?.trim() || "viewer").toUpperCase();
                      const ownerLabel = isOwner
                        ? "Mi horario"
                        : profile.ownerName?.trim()
                          ? `Compartido por ${profile.ownerName.trim()}`
                          : "Compartido";
                      return (
                        <option key={profile.profileId} value={String(profile.profileId)}>
                          {`${profile.profileName} - ${ownerLabel} - ${roleLabel}`}
                        </option>
                      );
                    })
                  )}
                </select>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Organiza tus actividades con horas exactas (ejemplo 10:30 a 11:23).
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Perfil: <span className="font-semibold text-slate-700">{scheduleProfileName || "Mi horario"}</span>{" "}
              - Rol: <span className="font-semibold uppercase text-slate-700">{scheduleAccessRole || "owner"}</span>
              {scheduleOwnerUserId != null && user?.id === scheduleOwnerUserId ? " - Propietario" : ""}
              {!scheduleCanEdit ? " - Solo lectura" : ""}
            </p>
            {scheduleMessage ? (
              <p
                className={`mt-2 text-sm ${
                  scheduleMessageType === "error"
                    ? "text-rose-700"
                    : scheduleMessageType === "success"
                      ? "text-emerald-700"
                      : "text-blue-700"
                }`}
              >
                {scheduleMessage}
              </p>
            ) : null}
          </DataCard>

          {showCreateScheduleModal ? (
            <ModalShell
              title={editingScheduleId != null ? "Editar actividad de horario" : "Nueva actividad de horario"}
              onClose={() => {
                setShowCreateScheduleModal(false);
                setEditingScheduleId(null);
                setScheduleActionMenuId(null);
              }}
            >
              {scheduleFormFields}
            </ModalShell>
          ) : null}

          {(scheduleViewMode === "weekly" || scheduleViewMode === "image") ? (
            <div className="grid gap-3">
              <article className="rounded-xl border border-slate-200 bg-white p-3 pb-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">Horario semanal editable</p>
                <p className="mt-1 text-xs text-slate-500">
                  Registra horarios exactos por minuto (ejemplo: 08:30 - 11:25). La grilla es compacta para lectura rapida.
                </p>
                <div className="mt-2 overflow-x-auto pb-2">
                  <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-1.5 py-2 text-left text-[11px] font-semibold text-slate-600">
                          Hora
                        </th>
                        {scheduleWeekDays.map((day) => (
                          <th
                            key={day.key}
                            className="border-b border-slate-200 bg-white px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                          >
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleSlots.map((slot, rowIndex) => (
                        <tr key={slot.label}>
                          <td className="sticky left-0 z-10 border-b border-slate-200 bg-white px-1.5 py-2 align-top text-[11px] font-medium text-slate-600">
                            {slot.label}
                          </td>
                          {scheduleWeekDays.map((day) => {
                            const dayCells = scheduleGridByDay[day.key];
                            const cellModel = dayCells?.[rowIndex];
                            if (!cellModel || cellModel.skip) {
                              return null;
                            }
                            const baseRowHeight = 42;
                            const additionalRowVisualHeight = 55;
                            const minHeight =
                              cellModel.rowSpan <= 1
                                ? baseRowHeight
                                : baseRowHeight + (cellModel.rowSpan - 1) * additionalRowVisualHeight;
                            const singleActivity = cellModel.activities.length === 1 ? cellModel.activities[0] : null;
                            return (
                              <td
                                key={`${slot.label}-${day.key}`}
                                rowSpan={cellModel.rowSpan}
                                className="border-b border-slate-100 px-1.5 py-1.5 align-top"
                                >
                                  {singleActivity ? (
                                    <div
                                      className={`flex h-full flex-col justify-between rounded-md border px-1.5 pt-1.5 pb-1.5 text-[11px] font-semibold ${
                                        scheduleColorClasses(singleActivity.color).bg
                                      } ${scheduleColorClasses(singleActivity.color).border} ${scheduleColorClasses(singleActivity.color).text}`}
                                      style={{ height: `${minHeight}px` }}
                                      title={`${singleActivity.title} (${formatScheduleTimeRangeForDisplay(singleActivity.startTime, singleActivity.endTime)})`}
                                    >
                                      <div className="relative">
                                        <div className="flex items-start justify-between gap-1">
                                          <div className="min-w-0 pr-1">
                                            <p className="truncate">{singleActivity.title}</p>
                                            <p className="truncate text-[9px] font-medium opacity-80">
                                              {singleActivity.location?.trim() || "Sin ubicacion"}
                                            </p>
                                          </div>
                                          {scheduleCanEdit ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setScheduleActionMenuId((current) =>
                                                  current === singleActivity.id ? null : singleActivity.id,
                                                )
                                              }
                                              aria-label={`Opciones de ${singleActivity.title}`}
                                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-current hover:bg-white/50"
                                            >
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                className="h-3.5 w-3.5"
                                              >
                                                <circle cx="12" cy="5" r="1.8" />
                                                <circle cx="12" cy="12" r="1.8" />
                                                <circle cx="12" cy="19" r="1.8" />
                                              </svg>
                                            </button>
                                          ) : null}
                                        </div>
                                        {scheduleCanEdit && scheduleActionMenuId === singleActivity.id ? (
                                          <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
                                            <button
                                              type="button"
                                              onClick={() => onOpenEditScheduleActivity(singleActivity)}
                                              className="flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-semibold hover:bg-slate-100"
                                            >
                                              Editar
                                            </button>
                                            <button
                                              type="button"
                                              disabled={deletingScheduleActivityId === singleActivity.id}
                                              onClick={() => void onDeleteScheduleActivity(singleActivity.id)}
                                              className="flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {deletingScheduleActivityId === singleActivity.id ? "Eliminando..." : "Eliminar"}
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                      <p className="truncate text-[9px] opacity-80">
                                        {formatScheduleTimeRangeForDisplay(singleActivity.startTime, singleActivity.endTime)}
                                      </p>
                                    </div>
                                  ) : (
                                  <div
                                    className="space-y-1 rounded-md border border-slate-100 bg-slate-50 p-1"
                                    style={{ minHeight: `${minHeight}px` }}
                                  >
                                    {cellModel.activities.length === 0 ? (
                                      <span className="block text-[11px] text-slate-400">-</span>
                                    ) : (
                                      <>
                                        {cellModel.activities.slice(0, 2).map((activity) => {
                                          const colorStyle = scheduleColorClasses(activity.color);
                                          return (
                                            <div
                                              key={`${activity.id}-${slot.label}-${day.key}`}
                                              className={`relative rounded-md border px-1.5 pt-1.5 pb-1.5 text-[11px] font-semibold ${colorStyle.bg} ${colorStyle.border} ${colorStyle.text}`}
                                              title={`${activity.title} (${formatScheduleTimeRangeForDisplay(activity.startTime, activity.endTime)})`}
                                            >
                                              <div className="relative">
                                                <div className="flex items-start justify-between gap-1">
                                                  <div className="min-w-0 pr-1">
                                                    <p className="truncate">{activity.title}</p>
                                                    <p className="truncate text-[9px] font-medium opacity-80">
                                                      {activity.location?.trim() || "Sin ubicacion"}
                                                    </p>
                                                  </div>
                                                  {scheduleCanEdit ? (
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        setScheduleActionMenuId((current) =>
                                                          current === activity.id ? null : activity.id,
                                                        )
                                                      }
                                                      aria-label={`Opciones de ${activity.title}`}
                                                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-current hover:bg-white/50"
                                                    >
                                                      <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                        className="h-3.5 w-3.5"
                                                      >
                                                        <circle cx="12" cy="5" r="1.8" />
                                                        <circle cx="12" cy="12" r="1.8" />
                                                        <circle cx="12" cy="19" r="1.8" />
                                                      </svg>
                                                    </button>
                                                  ) : null}
                                                </div>
                                                {scheduleCanEdit && scheduleActionMenuId === activity.id ? (
                                                  <div className="absolute right-0 z-30 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
                                                    <button
                                                      type="button"
                                                      onClick={() => onOpenEditScheduleActivity(activity)}
                                                      className="flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-semibold hover:bg-slate-100"
                                                    >
                                                      Editar
                                                    </button>
                                                    <button
                                                      type="button"
                                                      disabled={deletingScheduleActivityId === activity.id}
                                                      onClick={() => void onDeleteScheduleActivity(activity.id)}
                                                      className="flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                      {deletingScheduleActivityId === activity.id ? "Eliminando..." : "Eliminar"}
                                                    </button>
                                                  </div>
                                                ) : null}
                                              </div>
                                              <p className="truncate text-[9px] opacity-80">
                                                {formatScheduleTimeRangeForDisplay(activity.startTime, activity.endTime)}
                                              </p>
                                            </div>
                                          );
                                        })}
                                        {cellModel.activities.length > 2 ? (
                                          <span className="block text-[10px] font-semibold text-slate-500">
                                            +{cellModel.activities.length - 2} mas
                                          </span>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          ) : null}
        </div>
      );
    }

    if (active === "ayuda" || active === "support") {
      const supportModule = parseSupportModulePayload(payload);
      const combinedConversationMap = new Map<number, SupportConversationItem>();
      supportModule.conversations.forEach((conversation) => {
        combinedConversationMap.set(conversation.id, conversation);
      });
      if (supportModule.adminView) {
        supportModule.adminQueue.forEach((conversation) => {
          if (!combinedConversationMap.has(conversation.id)) {
            combinedConversationMap.set(conversation.id, conversation);
          }
        });
      }
      const conversations = Array.from(combinedConversationMap.values());
      const selectedConversation =
        supportSelectedConversationId == null
          ? null
          : conversations.find((conversation) => conversation.id === supportSelectedConversationId) ?? null;
      const selectedConversationClosed =
        selectedConversation != null && (selectedConversation.status ?? "").trim().toLowerCase() === "closed";

      const priorityLabel = (value: string) => {
        const normalized = (value ?? "").trim().toLowerCase();
        if (normalized === "low") {
          return "Baja";
        }
        if (normalized === "high") {
          return "Alta";
        }
        if (normalized === "urgent") {
          return "Urgente";
        }
        return "Normal";
      };

      const channelLabel = (value: string) => {
        const normalized = (value ?? "").trim().toLowerCase();
        if (normalized === "whatsapp") {
          return "WhatsApp";
        }
        if (normalized === "call") {
          return "Llamada";
        }
        return "Chat";
      };

      const statusLabel = (value: string) => {
        const normalized = (value ?? "").trim().toLowerCase();
        if (normalized === "closed") {
          return "Cerrado";
        }
        if (normalized === "in_progress") {
          return "En curso";
        }
        return "Abierto";
      };

      return (
        <div className="w-full space-y-4">
          {supportMessage ? (
            <article
              className={`rounded-lg border px-3 py-2 text-sm ${
                supportMessageType === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : supportMessageType === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {supportMessage}
            </article>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1.7fr]">
            <DataCard title="Canales de ayuda">
              <p className="text-sm text-slate-600">Inicia un chat interno, abre WhatsApp o solicita llamada.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenSupportWhatsApp}
                  className="rounded-lg border border-[#004aad] bg-white px-3 py-2 text-sm font-semibold text-[#004aad] hover:bg-blue-50"
                >
                  Abrir WhatsApp
                </button>
                <a
                  href="tel:+51999999999"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Llamar soporte
                </a>
              </div>
              <p className="mt-3 text-xs text-slate-500">Numero de soporte: +51 999 999 999</p>
            </DataCard>

            <DataCard title="Mis conversaciones">
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {supportModule.conversations.length === 0 ? (
                  <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Aun no tienes conversaciones. Crea un caso nuevo abajo.
                  </article>
                ) : (
                  supportModule.conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSupportSelectedConversationId(conversation.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left ${
                        supportSelectedConversationId === conversation.id
                          ? "border-[#004aad] bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{conversation.subject}</p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {statusLabel(conversation.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {channelLabel(conversation.channelPreference)} - {priorityLabel(conversation.priority)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </DataCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1.7fr]">
            <DataCard title="Abrir nuevo caso">
              <form onSubmit={onCreateSupportConversation} className="space-y-3">
                <input
                  value={supportSubject}
                  onChange={(event) => setSupportSubject(event.target.value)}
                  placeholder="Asunto"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  required
                />
                <textarea
                  value={supportInitialMessage}
                  onChange={(event) => setSupportInitialMessage(event.target.value)}
                  placeholder="Describe el problema o solicitud"
                  className="h-24 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  required
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <select
                    value={supportPriority}
                    onChange={(event) =>
                      setSupportPriority(event.target.value as "low" | "normal" | "high" | "urgent")
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  >
                    <option value="low">Prioridad baja</option>
                    <option value="normal">Prioridad normal</option>
                    <option value="high">Prioridad alta</option>
                    <option value="urgent">Prioridad urgente</option>
                  </select>
                  <select
                    value={supportChannel}
                    onChange={(event) => setSupportChannel(event.target.value as "chat" | "whatsapp" | "call")}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  >
                    <option value="chat">Canal: Chat</option>
                    <option value="whatsapp">Canal: WhatsApp</option>
                    <option value="call">Canal: Llamada</option>
                  </select>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    value={supportWhatsappNumber}
                    onChange={(event) => setSupportWhatsappNumber(event.target.value)}
                    placeholder="WhatsApp (opcional)"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  />
                  <input
                    value={supportCallNumber}
                    onChange={(event) => setSupportCallNumber(event.target.value)}
                    placeholder="Telefono llamada (opcional)"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={supportCreatingConversation}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {supportCreatingConversation ? "Creando..." : "Crear caso"}
                  </button>
                </div>
              </form>
            </DataCard>

            <DataCard title={selectedConversation ? `Chat: ${selectedConversation.subject}` : "Chat de soporte"}>
              {selectedConversation == null ? (
                <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Selecciona una conversacion para ver y enviar mensajes.
                </article>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600">
                      Estado: <span className="font-semibold">{statusLabel(selectedConversation.status)}</span>
                    </p>
                    {supportModule.adminView ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void onAssignSupportConversation(selectedConversation.id)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Asignarme
                        </button>
                        <button
                          type="button"
                          onClick={() => void onCloseSupportConversation(selectedConversation.id)}
                          className="rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Cerrar
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {supportLoadingMessages ? (
                      <p className="text-sm text-slate-600">Cargando mensajes...</p>
                    ) : supportMessages.length === 0 ? (
                      <p className="text-sm text-slate-600">Sin mensajes por ahora.</p>
                    ) : (
                      supportMessages.map((message) => {
                        const isCurrentUser = message.senderUserId === user.id;
                        const isAdminMessage = (message.senderRole ?? "").toLowerCase() === "admin";
                        return (
                          <article
                            key={message.id}
                            className={`max-w-[92%] rounded-xl border px-3 py-2 text-sm ${
                              isCurrentUser
                                ? "ml-auto border-blue-200 bg-blue-50 text-slate-800"
                                : isAdminMessage
                                  ? "border-emerald-200 bg-emerald-50 text-slate-800"
                                  : "border-slate-200 bg-white text-slate-800"
                            }`}
                          >
                            <p className="text-xs font-semibold text-slate-600">
                              {message.senderName?.trim() || "Usuario"}
                              {isAdminMessage ? " (Admin)" : ""}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                          </article>
                        );
                      })
                    )}
                  </div>
                  <form onSubmit={onSendSupportMessage} className="mt-2 flex items-center gap-2">
                    <input
                      value={supportDraftMessage}
                      onChange={(event) => setSupportDraftMessage(event.target.value)}
                      placeholder={selectedConversationClosed ? "Conversacion cerrada" : "Escribe tu mensaje"}
                      disabled={selectedConversationClosed || supportSendingMessage}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad] disabled:bg-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={selectedConversationClosed || supportSendingMessage}
                      className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                    >
                      {supportSendingMessage ? "Enviando..." : "Enviar"}
                    </button>
                  </form>
                </>
              )}
            </DataCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1.7fr]">
            <DataCard title="Solicitar llamada">
              <form onSubmit={onCreateSupportCallRequest} className="space-y-3">
                <input
                  value={supportCallPhone}
                  onChange={(event) => setSupportCallPhone(event.target.value)}
                  placeholder="Telefono de contacto"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  required
                />
                <input
                  value={supportCallSchedule}
                  onChange={(event) => setSupportCallSchedule(event.target.value)}
                  placeholder="Horario preferido (opcional)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                />
                <textarea
                  value={supportCallReason}
                  onChange={(event) => setSupportCallReason(event.target.value)}
                  placeholder="Motivo de la llamada"
                  className="h-20 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#004aad]"
                  required
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={supportCreatingCallRequest}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                  >
                    {supportCreatingCallRequest ? "Enviando..." : "Solicitar llamada"}
                  </button>
                </div>
              </form>
            </DataCard>

            <DataCard title={supportModule.adminView ? "Cola admin de soporte" : "Historial de llamadas"}>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {(supportModule.adminView ? supportModule.adminQueue : supportModule.callRequests).length === 0 ? (
                  <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Sin registros por ahora.
                  </article>
                ) : supportModule.adminView ? (
                  supportModule.adminQueue.map((conversation) => (
                    <article key={conversation.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{conversation.subject}</p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {statusLabel(conversation.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {conversation.requesterName} ({conversation.requesterUsername ? `@${conversation.requesterUsername}` : "sin usuario"})
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSupportSelectedConversationId(conversation.id);
                            void onAssignSupportConversation(conversation.id);
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Asignarme
                        </button>
                        <button
                          type="button"
                          onClick={() => void onCloseSupportConversation(conversation.id)}
                          className="rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Cerrar
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  supportModule.callRequests.map((callRequest) => (
                    <article key={callRequest.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-sm font-semibold text-slate-800">{callRequest.phoneNumber}</p>
                      <p className="mt-1 text-xs text-slate-600">{callRequest.reason}</p>
                      {callRequest.preferredSchedule ? (
                        <p className="mt-1 text-xs text-slate-500">Horario: {callRequest.preferredSchedule}</p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </DataCard>
          </div>
        </div>
      );
    }

    if (active === "configuracion") {
      return (
        <DataCard title="Configuracion">
          <p className="text-sm text-slate-700">
            Aqui podras ajustar preferencias de cuenta y del panel.
          </p>
        </DataCard>
      );
    }

    if (active === "perfil" || active === "profile") {
      return (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Informacion del perfil</h2>
            <p className="mt-1 text-sm text-slate-600">
              Actualiza los datos principales de tu cuenta.
            </p>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">Foto de perfil</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="relative h-24 w-24 overflow-hidden rounded-full border border-slate-300 bg-white">
                  {profileImageData ? (
                    <img
                      src={profileImageData}
                      alt="Foto de perfil"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={profileImagePreviewStyle}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-slate-500">
                      {user.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenProfileImageEditor}
                    className="rounded-lg bg-[#004aad] px-3 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteProfileImage}
                    disabled={!profileImageData}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>

            <form onSubmit={onSaveProfileInfo} className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Usuario</label>
                <input
                  value={profileUsername}
                  onChange={(event) => setProfileUsername(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
              </div>

              <div className="md:col-span-2 flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={profileInfoSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                >
                  {profileInfoSaving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>

            {showEditProfileImageModal ? (
              <ModalShell
                title="Editar foto de perfil"
                onClose={() => {
                  setShowEditProfileImageModal(false);
                }}
              >
                <div className="space-y-4">
                  <div
                    ref={profileImageEditorViewportRef}
                    onMouseDown={onStartProfileImageDrag}
                    onTouchStart={onStartProfileImageTouchDrag}
                    className={`mx-auto h-64 w-64 overflow-hidden rounded-full border border-slate-300 bg-slate-100 sm:h-72 sm:w-72 ${
                      profileImageDraftData && profileImageDraftScale > 1
                        ? profileImageDragging
                          ? "cursor-grabbing"
                          : "cursor-grab"
                        : "cursor-default"
                    }`}
                  >
                    {profileImageDraftData ? (
                      <img
                        src={profileImageDraftData}
                        alt="Vista previa de foto de perfil"
                        className="h-full w-full object-cover"
                        style={profileImageDraftPreviewStyle}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-center text-sm font-semibold text-slate-500">
                        Carga una imagen
                      </div>
                    )}
                  </div>
                  <p className="text-center text-xs text-slate-600">
                    Usa zoom y arrastra la imagen a izquierda/derecha para encuadrar sin espacios en blanco.
                  </p>

                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Cambiar foto
                      </label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        onChange={(event) => void onProfileImageDraftFileChange(event)}
                        className="block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#004aad] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#003b88]"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Zoom
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={profileImageDraftScale}
                        onChange={(event) => {
                          const nextScale = Math.min(3, Math.max(1, Number(event.target.value)));
                          setProfileImageDraftScale(nextScale);
                          setProfileImageDraftOffsetX((current) => clampProfileImageOffsetX(current, nextScale));
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEditProfileImageModal(false)}
                      disabled={profileImageSaving}
                      className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={onSaveProfileImageDraft}
                      disabled={profileImageSaving}
                      className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88] disabled:opacity-70"
                    >
                      {profileImageSaving ? "Guardando foto..." : "Guardar foto"}
                    </button>
                  </div>

                  {profileInfoMessage ? (
                    <p
                      className={`text-sm ${
                        profileInfoMessageType === "success" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {profileInfoMessage}
                    </p>
                  ) : null}
                </div>
              </ModalShell>
            ) : null}

            {profileInfoMessage ? (
              <p
                className={`mt-2 text-sm ${
                  profileInfoMessageType === "success" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {profileInfoMessage}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Actualizar password</h2>
            <p className="mt-1 text-sm text-slate-600">
              {profileRequiresCurrentPassword
                ? "Usa una password larga y segura para proteger tu cuenta."
                : "Tu cuenta fue creada con Google. Define tu primera password local para poder iniciar tambien con usuario/password."}
            </p>

            <form onSubmit={onSaveProfilePassword} className="mt-4 grid gap-3 md:grid-cols-2">
              {profileRequiresCurrentPassword ? (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Password actual</label>
                  <input
                    type="password"
                    value={profileCurrentPassword}
                    onChange={(event) => setProfileCurrentPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                    required
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nueva password</label>
                <input
                  type="password"
                  value={profileNewPassword}
                  onChange={(event) => setProfileNewPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirmar password</label>
                <input
                  type="password"
                  value={profileConfirmPassword}
                  onChange={(event) => setProfileConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                  required
                />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={profilePasswordSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-70"
                >
                  {profilePasswordSaving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>

            {profilePasswordMessage ? (
              <p
                className={`mt-2 text-sm ${
                  profilePasswordMessageType === "success" ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {profilePasswordMessage}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-rose-700">Eliminar cuenta</h2>
            <p className="mt-1 text-sm text-slate-600">
              Esta accion quitara tu sesion y eliminara tu cuenta en este entorno local.
            </p>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountMessage("");
                  setDeleteAccountPassword("");
                  setShowDeleteAccountPanel(true);
                }}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Eliminar cuenta
              </button>
            </div>
          </section>

          {showDeleteAccountPanel ? (
            <ModalShell
              title="Confirmar eliminacion de cuenta"
              onClose={() => setShowDeleteAccountPanel(false)}
            >
              <form onSubmit={onDeleteAccount} className="space-y-3">
                <p className="text-sm text-slate-700">
                  Ingresa tu password para confirmar que deseas eliminar la cuenta.
                </p>
                <input
                  type="password"
                  value={deleteAccountPassword}
                  onChange={(event) => setDeleteAccountPassword(event.target.value)}
                  placeholder="Password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                />

                {deleteAccountMessage ? (
                  <p
                    className={`text-sm ${
                      deleteAccountMessageType === "success" ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {deleteAccountMessage}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteAccountPanel(false)}
                    className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={deleteAccountSaving}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-70"
                  >
                    {deleteAccountSaving ? "Eliminando..." : "Confirmar eliminacion"}
                  </button>
                </div>
              </form>
            </ModalShell>
          ) : null}
        </div>
      );
    }

    return null;
  };

  if (!user) {
    return <div className="p-6 text-sm text-slate-700">Cargando sesion...</div>;
  }

  return (
    <div className="h-dvh overflow-hidden bg-slate-100">
      <div className="flex h-full">
        {sidebarOpen ? (
          <aside className="w-[260px] min-w-[260px] border-r border-white/10 bg-[#1f242c] p-3 text-slate-100">
            <div className="px-2 py-2 text-center">
              <button
                type="button"
                onClick={onOpenProfileImageEditorFromSidebar}
                title="Editar foto de perfil"
                className="group relative mx-auto mb-2 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-slate-400/40 text-2xl font-bold transition hover:border-white/60 hover:ring-2 hover:ring-white/20"
              >
                {profileImageData ? (
                  <img
                    src={profileImageData}
                    alt="Foto de perfil"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={profileImagePreviewStyle}
                  />
                ) : (
                  user.name.slice(0, 1).toUpperCase()
                )}
              </button>
              <p className="text-sm font-bold uppercase">{user.name}</p>
              <p className="text-xs uppercase text-slate-300">{isAdmin ? "admin" : "user"}</p>
            </div>
            <hr className="my-3 border-white/25" />
            <nav className="space-y-1">
              {menu.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActive(item.key)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold uppercase tracking-wide transition ${
                    active === item.key
                      ? "bg-white/20 text-white"
                      : "text-slate-100 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <MenuItemIcon itemKey={item.key} />
                    <span>{item.label}</span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-3 py-3 text-white sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((value) => !value)}
                aria-label={sidebarOpen ? "Ocultar menu lateral" : "Mostrar menu lateral"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>

              <Image src="/smartlearn.png" alt="SmartLearn" width={120} height={32} className="h-7 w-auto sm:h-8" />
              <span className="hidden max-w-[10rem] truncate text-xs font-semibold uppercase tracking-wide md:inline lg:max-w-[14rem]">
                {active || "panel"}
              </span>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowTutorialModal(true);
                  setNotificationPanelOpen(false);
                  setUserMenuOpen(false);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 text-xs font-semibold uppercase tracking-wide leading-none text-cyan-100 transition-colors hover:bg-cyan-500/30 sm:h-11 sm:px-4 sm:text-sm"
                title={`Ver tutorial de ${activeTutorialGuide.sectionTitle}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m10 9 5 3-5 3z" />
                </svg>
                <span className="hidden lg:inline">Tutorial</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationPanelOpen((value) => !value);
                    setUserMenuOpen(false);
                  }}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 sm:h-11 sm:w-11"
                  aria-label="Notificaciones"
                  aria-expanded={notificationPanelOpen}
                  title="Notificaciones"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 17h5l-1.405-1.405A2.03 2.03 0 0 1 18 14.158V11a6 6 0 1 0-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a3 3 0 1 0 6 0" />
                  </svg>
                  {unreadNotificationsCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {unreadNotificationsBadgeLabel}
                    </span>
                  ) : null}
                </button>

                {notificationPanelOpen ? (
                  <div className="fixed left-2 right-2 top-[4.25rem] z-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-[min(95vw,420px)]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        Notificaciones{unreadNotificationsCount > 0 ? ` (${unreadNotificationsBadgeLabel})` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => void onMarkAllNotificationsAsRead()}
                        disabled={markingAllNotifications || unreadNotificationsCount === 0}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {markingAllNotifications ? "Marcando..." : "Marcar todas"}
                      </button>
                    </div>

                    <div className="mt-3 max-h-[52dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-[360px]">
                      {homeShareNotificationsLoading ? (
                        <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          Cargando...
                        </article>
                      ) : quickHeaderNotifications.length === 0 ? (
                        <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          No tienes notificaciones.
                        </article>
                      ) : (
                        quickHeaderNotifications.map((notification) => {
                          const invitationStatus = normalizeInvitationStatus(notification.invitationStatus);
                          const requiresInvitationResponse = notificationRequiresInvitationResponse(notification.resourceType);
                          const resourceTypeText =
                            notification.resourceType === "exam"
                              ? "Examen"
                              : notification.resourceType === "course"
                                ? "Curso"
                                : notification.resourceType === "schedule"
                                  ? "Horario"
                                : notification.resourceType === "sala"
                                  ? "Sala"
                                  : "Recurso";
                          const isPendingInvite = requiresInvitationResponse && invitationStatus === "pending";
                          const isRead = !!notification.readAt;
                          const canOpenResource = requiresInvitationResponse
                            ? invitationStatus === "accepted"
                            : Boolean(notification.token && notification.token.trim());

                          return (
                            <article
                              key={`header-notification-${notification.id}`}
                              className={`rounded-lg border px-3 py-2 ${
                                isRead ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"
                              }`}
                            >
                              <p className="text-sm font-semibold text-slate-800">
                                {resourceTypeText}: {notification.resourceName?.trim() || "Sin nombre"}
                              </p>
                              <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                                {notification.message?.trim() || "Recibiste una invitacion compartida."}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {formatExamCreatedAt(notification.createdAt, undefined)}
                              </p>
                              <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                                {isPendingInvite ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={
                                        notificationActionLoadingId === notification.id || markingAllNotifications
                                      }
                                      onClick={() => void onRejectNotificationInvitation(notification)}
                                      className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Rechazar
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        notificationActionLoadingId === notification.id || markingAllNotifications
                                      }
                                      onClick={() => void onAcceptNotificationInvitation(notification)}
                                      className="rounded-md bg-[#004aad] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#003b88] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Aceptar
                                    </button>
                                  </>
                                ) : canOpenResource ? (
                                  <button
                                    type="button"
                                    onClick={() => void onOpenNotificationResource(notification)}
                                    className="rounded-md bg-[#004aad] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#003b88]"
                                  >
                                    {notification.resourceType === "exam"
                                      ? "Ver examen"
                                      : notification.resourceType === "schedule"
                                        ? "Ver horario"
                                        : "Abrir"}
                                  </button>
                                ) : null}
                                {!isRead ? (
                                  <button
                                    type="button"
                                    disabled={
                                      notificationActionLoadingId === notification.id || markingAllNotifications
                                    }
                                    onClick={() => void onMarkNotificationAsRead(notification)}
                                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Leida
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setActive("notificaciones");
                          setNotificationPanelOpen(false);
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Ver todas
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen((value) => !value);
                    setNotificationPanelOpen(false);
                  }}
                  className="inline-flex h-10 min-w-0 max-w-[11.5rem] items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2.5 text-xs font-semibold uppercase tracking-wide leading-none text-white transition-colors hover:bg-white/20 sm:h-11 sm:max-w-[16rem] sm:px-3.5 sm:text-sm"
                >
                  <span className="relative h-8 w-8 overflow-hidden rounded-full border border-white/25 bg-white/20 text-xs font-bold text-white">
                    {profileImageData ? (
                      <img
                        src={profileImageData}
                        alt="Mi foto"
                        className="absolute inset-0 h-full w-full object-cover"
                        style={profileImagePreviewStyle}
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        {user.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="max-w-[7.5rem] truncate sm:max-w-[11rem]">{user.username}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {userMenuOpen ? (
                  <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={onOpenProfileImageEditorFromSidebar}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 4.5a2.1 2.1 0 1 1 3 3L8 17l-4 1 1-4 9.5-9.5Z" />
                      </svg>
                      Foto de perfil
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActive("configuracion");
                        setUserMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h7" />
                        <circle cx="14" cy="6" r="2" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h3" />
                        <circle cx="10" cy="12" r="2" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 18h11" />
                        <circle cx="18" cy="18" r="2" />
                      </svg>
                      Configuracion
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActive("perfil");
                        setUserMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <circle cx="12" cy="8" r="4" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0 1 14 0" />
                      </svg>
                      Perfil
                    </button>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="h-4 w-4"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H9" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
                      </svg>
                      Cerrar sesion
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <main
            className={`flex min-h-0 flex-1 px-4 pt-4 ${active === "ia" ? "overflow-hidden pb-0" : "overflow-y-auto pb-0"}`}
          >
            <div className={`${active === "ia" ? "flex h-full min-h-0 box-border pb-7" : "min-h-full"} w-full`}>
              {renderContent()}
              {active === "ia" ? null : <div className="h-7 w-full" aria-hidden="true" />}
            </div>
          </main>

          {showTutorialModal ? (
            <ModalShell
              title={`Tutorial: ${activeTutorialGuide.sectionTitle}`}
              onClose={() => setShowTutorialModal(false)}
            >
              <div className="space-y-4">
                <p className="text-sm text-slate-700">{activeTutorialGuide.description}</p>

                {activeTutorialEmbedUrl ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                      <iframe
                        src={activeTutorialEmbedUrl}
                        title={`Tutorial de ${activeTutorialGuide.sectionTitle}`}
                        className="absolute inset-0 h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Tutorial en video no configurado para este modulo. Agrega el enlace de YouTube en
                    <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                      tutorialGuideBySection
                    </code>
                    dentro de <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">dashboard/page.tsx</code>.
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">Pasos rapidos</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {activeTutorialGuide.quickSteps.map((step, index) => (
                      <li key={`tutorial-step-${index}`}>{step}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTutorialModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cerrar
                  </button>
                  {activeTutorialGuide.youtubeUrl ? (
                    <a
                      href={activeTutorialGuide.youtubeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      Abrir en YouTube
                    </a>
                  ) : null}
                </div>
              </div>
            </ModalShell>
          ) : null}

          {shareTarget ? (
            <ModalShell
              title={`Compartir ${
                shareTarget.resourceType === "exam"
                  ? "examen"
                  : shareTarget.resourceType === "course"
                    ? "curso"
                    : shareTarget.resourceType === "schedule"
                      ? "horario"
                      : "sala"
              }`}
              onClose={closeShareModal}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Recurso: <span className="font-semibold">{shareTarget.resourceName}</span>
                </p>

                {/* --- 1. ENLACE PÚBLICO --- */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                    <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Enlace Publico (WhatsApp / Externo)
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">Genera un enlace general para que cualquier persona pueda unirse a este recurso. Al usar esta opcion no se enviaran notificaciones internas a los usuarios.</p>
                  
                  {publicShareLink ? (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <input
                        value={publicShareLink}
                        readOnly
                        onClick={(e) => e.currentTarget.select()}
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => void onCopyShareLink(publicShareLink)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Copiar
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-start mt-2">
                      <button
                        type="button"
                        onClick={() => void onGeneratePublicShareLink()}
                        disabled={creatingPublicShareLink}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70 transition-colors"
                      >
                        {creatingPublicShareLink ? "Generando..." : "Crear enlace publico"}
                      </button>
                    </div>
                  )}
                </div>

                {/* --- 2. INVITACIONES INTERNAS MANUALES --- */}
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                      <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Enviar Invitaciones Internas
                    </h3>
                    <p className="text-xs text-slate-600 mt-1">Busca usuarios especificos y enviales una notificacion directa hacia su cuenta en SmartLearn.</p>
                  </div>

                  {shareTarget.resourceType === "exam" ? (
                    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Permiso al compartir
                        </label>
                        <select
                          value={shareExamRole}
                          onChange={(event) => setShareExamRole(event.target.value === "editor" ? "editor" : "viewer")}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500"
                        >
                          <option value="viewer">Solo repaso</option>
                          <option value="editor">Puede editar</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 self-end h-max">
                        <input
                          type="checkbox"
                          checked={shareExamCanShare}
                          onChange={(event) => setShareExamCanShare(event.target.checked)}
                        />
                        Otorgar poder de compartir
                      </label>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {(() => {
                      const validSelectedIds = shareSelectedRecipientIds.filter(
                        (id) => !examParticipants.some((p) => p.userId === id)
                      );
                      
                      return (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Buscar usuarios
                            </label>
                            <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              Seleccionados: <span className="font-bold text-blue-600">{validSelectedIds.length}</span>
                            </span>
                          </div>

                    <input
                      value={shareRecipientSearch}
                      onChange={(event) => setShareRecipientSearch(event.target.value)}
                      placeholder="Buscar por nombre, usuario o correo..."
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <p className="text-[11px] text-slate-500">Escribe al menos 2 caracteres para buscar usuarios.</p>

                    {shareRecipientsLoading ? (
                      <p className="text-sm text-slate-500 italic py-2">Buscando usuarios...</p>
                    ) : (
                      <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                        {shareRecipients
                          .filter((recipient) => {
                            const query = shareRecipientSearch.trim().toLowerCase();
                            if (query.length < 2) {
                              return false;
                            }
                            return `${recipient.name} ${recipient.username} ${recipient.email}`
                              .toLowerCase()
                              .includes(query);
                          })
                          .map((recipient) => {
                            const selected = shareSelectedRecipientIds.includes(recipient.id);
                            
                            // Verificar si el usuario ya pertenece al recurso actual (solo para exams, pero puede servir p/ cursos luego)
                            const alreadyHasAccess = examParticipants.some((p) => p.userId === recipient.id);

                            if (alreadyHasAccess) {
                              return (
                                <label
                                  key={recipient.id}
                                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 opacity-60 cursor-not-allowed"
                                >
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    disabled
                                    readOnly
                                    className="h-4 w-4 text-slate-400 rounded border-slate-300"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-slate-600">{recipient.name}</p>
                                    <p className="truncate text-[11px] text-slate-400">
                                      @{recipient.username} &bull; {recipient.email}
                                    </p>
                                  </div>
                                  <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">
                                    Ya pertenece
                                  </span>
                                </label>
                              );
                            }

                            return (
                              <label
                                key={recipient.id}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(selected)}
                                  className="h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                  onChange={(event) => {
                                    setShareSelectedRecipientIds((current) => {
                                      if (event.target.checked) {
                                        return current.includes(recipient.id) ? current : [...current, recipient.id];
                                      }
                                      return current.filter((item) => item !== recipient.id);
                                    });
                                  }}
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-800">{recipient.name}</p>
                                  <p className="truncate text-[11px] text-slate-500">
                                    @{recipient.username} &bull; {recipient.email}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        {shareRecipients.filter((recipient) => {
                          const query = shareRecipientSearch.trim().toLowerCase();
                          if (query.length < 2) {
                            return false;
                          }
                          return `${recipient.name} ${recipient.username} ${recipient.email}`
                            .toLowerCase()
                            .includes(query);
                        }).length === 0 ? (
                          <p className="text-sm text-slate-400 py-2 text-center">
                            {shareRecipientSearch.trim().length < 2
                              ? "Escribe al menos 2 caracteres para buscar."
                              : "No se encontraron usuarios coincidentes."}
                          </p>
                        ) : null}
                      </div>
                    )}

                    <div className="flex justify-end pt-2 border-t border-slate-100 mt-2">
                      <button
                        type="button"
                        onClick={() => void onGenerateShareLink()}
                        disabled={creatingShareLink || validSelectedIds.length === 0}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {creatingShareLink ? "Enviando..." : `Enviar ${validSelectedIds.length} invitacion(es)`}
                      </button>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* --- 3. ACCESOS ACTUALES --- */}
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                    <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Accesos actuales al recurso
                  </h3>
                  {shareTarget.resourceType === "exam" ? (
                    <div className="max-h-32 overflow-y-auto pr-1 space-y-1.5 mt-2 border border-slate-200 rounded-md p-2 bg-white">
                      {examParticipantsLoading ? (
                        <p className="text-xs text-slate-500 py-1 text-center italic">Cargando participantes...</p>
                      ) : examParticipants.length > 0 ? (
                          (() => {
                            const canManageParticipants = examParticipants.some(
                              (participant) =>
                                participant.userId === user?.id && (participant.owner || participant.role === "owner"),
                            );
                            return examParticipants.map((p: ExamParticipant) => (
                              <div key={p.userId} className="flex items-center justify-between gap-2 text-xs p-1 hover:bg-slate-50 rounded">
                                <span className="min-w-0 font-medium text-slate-800 truncate">
                                  {p.name} <span className="text-slate-400 font-normal">@{p.username}</span>
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">
                                    {p.owner ? "Propietario" : p.role === "editor" ? "Editor" : "Lector"}
                                  </span>
                                  {canManageParticipants && !p.owner && p.role !== "owner" ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!shareTarget || shareTarget.resourceType !== "exam") {
                                          return;
                                        }
                                        onRequestRemoveExamParticipant(shareTarget.resourceId, p, shareTarget.resourceName);
                                      }}
                                      disabled={updatingExamParticipantUserId === p.userId}
                                      className="rounded border border-rose-300 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Quitar
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ));
                          })()
                      ) : (
                          <p className="text-xs text-slate-500 py-1 text-center italic">Aun nadie tiene acceso a este examen.</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic mt-1 leading-tight">Muestra los usuarios que ya tienen acceso al examen actual para que no los invites dos veces.</p>
                  )}
                </div>

              </div>
            </ModalShell>
          ) : null}

          {showExamParticipantsModal && examParticipantsTarget ? (
            <ModalShell
              title={`Participantes: ${examParticipantsTarget.name}`}
              onClose={() => {
                setShowExamParticipantsModal(false);
                setExamParticipantsTarget(null);
                setExamParticipants([]);
                setUpdatingExamParticipantUserId(null);
                setRemoveExamParticipantPrompt(null);
              }}
            >
              <div className="space-y-3">
                {examParticipantsLoading ? (
                  <p className="text-sm text-slate-600">Cargando participantes...</p>
                ) : examParticipants.length === 0 ? (
                  <p className="text-sm text-slate-600">No hay participantes registrados.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {examParticipants.map((participant) => (
                      <article
                        key={participant.userId}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-slate-200 text-[10px] font-bold text-slate-700">
                              {participant.profileImageUrl ? (
                                <img
                                  src={participant.profileImageUrl}
                                  alt={participant.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : participant.userId === user?.id && profileImageData ? (
                                <img
                                  src={profileImageData}
                                  alt={participant.name}
                                  className="h-full w-full object-cover"
                                  style={profileImagePreviewStyle}
                                />
                              ) : (
                                (participant.name || "?")
                                  .split(" ")
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((part) => part[0]?.toUpperCase() ?? "")
                                  .join("") || "?"
                              )}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">
                              {participant.name}{" "}
                              <span className="text-xs font-medium text-slate-500">@{participant.username}</span>
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white">
                              {participant.role === "owner"
                                ? "Propietario"
                                : participant.role === "editor"
                                  ? "Editor"
                                  : "Lector"}
                            </span>
                            {participant.canShare ? (
                              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                Comparte
                              </span>
                            ) : null}
                            {participant.canStartGroup ? (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                Inicia grupal
                              </span>
                            ) : null}
                            {participant.canRenameExam ? (
                              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                Renombra examen
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{participant.email}</p>
                        {(examParticipantsTarget.accessRole ?? "viewer").toLowerCase() === "owner" &&
                        participant.role !== "owner" ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateExamParticipantPermissions(
                                  participant,
                                  participant.role === "editor" ? "viewer" : "editor",
                                  Boolean(participant.canShare),
                                  Boolean(participant.canStartGroup),
                                  Boolean(participant.canRenameExam),
                                )
                              }
                              disabled={updatingExamParticipantUserId === participant.userId}
                              className="rounded-lg border border-indigo-300 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {participant.role === "editor" ? "Quitar edicion" : "Dar edicion"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateExamParticipantPermissions(
                                  participant,
                                  participant.role === "editor" ? "editor" : "viewer",
                                  !Boolean(participant.canShare),
                                  Boolean(participant.canStartGroup),
                                  Boolean(participant.canRenameExam),
                                )
                              }
                              disabled={updatingExamParticipantUserId === participant.userId}
                              className="rounded-lg border border-blue-300 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {participant.canShare ? "Quitar compartir" : "Permitir compartir"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateExamParticipantPermissions(
                                  participant,
                                  participant.role === "editor" ? "editor" : "viewer",
                                  Boolean(participant.canShare),
                                  !Boolean(participant.canStartGroup),
                                  Boolean(participant.canRenameExam),
                                )
                              }
                              disabled={updatingExamParticipantUserId === participant.userId}
                              className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {participant.canStartGroup ? "Quitar inicio grupal" : "Permitir inicio grupal"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateExamParticipantPermissions(
                                  participant,
                                  participant.role === "editor" ? "editor" : "viewer",
                                  Boolean(participant.canShare),
                                  Boolean(participant.canStartGroup),
                                  !Boolean(participant.canRenameExam),
                                )
                              }
                              disabled={updatingExamParticipantUserId === participant.userId}
                              className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {participant.canRenameExam ? "Quitar renombrar" : "Permitir renombrar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onRequestRemoveExamParticipant(
                                  examParticipantsTarget.id,
                                  participant,
                                  examParticipantsTarget.name,
                                );
                              }}
                              disabled={updatingExamParticipantUserId === participant.userId}
                              className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Quitar del examen
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </ModalShell>
          ) : null}

          {removeExamParticipantPrompt ? (
            <ModalShell title="Quitar participante" onClose={onCancelRemoveExamParticipant}>
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Vas a quitar a <span className="font-semibold">{removeExamParticipantPrompt.participant.name}</span> del
                  examen <span className="font-semibold">{removeExamParticipantPrompt.examName}</span>.
                </p>
                <p className="text-xs text-slate-500">
                  Esta accion revoca su acceso al examen y al repaso individual asociado.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onCancelRemoveExamParticipant}
                    disabled={updatingExamParticipantUserId === removeExamParticipantPrompt.participant.userId}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void onConfirmRemoveExamParticipant()}
                    disabled={updatingExamParticipantUserId === removeExamParticipantPrompt.participant.userId}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updatingExamParticipantUserId === removeExamParticipantPrompt.participant.userId
                      ? "Quitando..."
                      : "Quitar del examen"}
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}

          {claimedExamInvitePrompt ? (
            <ModalShell title="Invitacion aceptada" onClose={onStayOnHomeAfterClaim}>
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  El examen <span className="font-semibold">{claimedExamInvitePrompt.examName}</span> ya se agrego a tu
                  lista de examenes.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={onStayOnHomeAfterClaim}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Quedarse en inicio
                  </button>
                  <button
                    type="button"
                    onClick={() => void onGoToClaimedExam()}
                    className="rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white hover:bg-[#003b88]"
                  >
                    Ir a examenes
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}

          {showGroupRoomClosedModal ? (
            <ModalShell
              title="Sala cerrada"
              onClose={groupRoomClosedAllowKeepViewing ? onKeepViewingClosedGroupRoomResult : onGoToExamsAfterGroupRoomClosed}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{groupRoomClosedMessage}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  {groupRoomClosedAllowKeepViewing ? (
                    <button
                      type="button"
                      onClick={onKeepViewingClosedGroupRoomResult}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Seguir viendo resultado final
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onGoToExamsAfterGroupRoomClosed}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Volver a examenes
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}

          {sessionExpiredModalOpen ? (
            <ModalShell title="Sesion expirada" onClose={onConfirmExpiredSession}>
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{sessionExpiredMessage}</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onConfirmExpiredSession}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Ir al login
                  </button>
                </div>
              </div>
            </ModalShell>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ApiResponsePayload = {
  error?: string;
  message?: string;
  [key: string]: unknown;
};

function emitSessionExpiredEvent(reason: "inactive" | "unauthorized") {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT_NAME, { detail: { reason } }));
}

function handleSessionErrorStatus(status: number) {
  if (status === 401 || status === 403) {
    emitSessionExpiredEvent("unauthorized");
  }
}

async function readApiPayload(response: Response): Promise<ApiResponsePayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as ApiResponsePayload;
    } catch {
      return {};
    }
  }

  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as ApiResponsePayload;
  } catch {
    return { message: raw };
  }
}

async function fetchJson(path: string, token: string): Promise<unknown> {
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    throw new Error(data.error || data.message || "Error consultando API");
  }

  return data;
}

async function postJson(path: string, token: string, body: unknown): Promise<unknown> {
  const resolvedUrl = resolveApiUrl(path);
  const response = await fetch(resolvedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    const apiMessage = data.error || data.message || "Error procesando solicitud";
    throw new Error(`${apiMessage} (HTTP ${response.status} POST ${resolvedUrl})`);
  }

  return data;
}

async function patchJson(path: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(resolveApiUrl(path), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    throw new Error(data.error || data.message || "Error actualizando");
  }

  return data;
}

async function putJson(path: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(resolveApiUrl(path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    throw new Error(data.error || data.message || "Error actualizando");
  }

  return data;
}

async function postFormData(path: string, token: string, formData: FormData): Promise<unknown> {
  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    throw new Error(data.error || data.message || "Error subiendo archivo");
  }

  return data;
}

async function deleteJson(path: string, token: string) {
  const response = await fetch(resolveApiUrl(path), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204) {
    return;
  }

  const data = await readApiPayload(response);

  if (!response.ok) {
    handleSessionErrorStatus(response.status);
    throw new Error(data.error || data.message || "Error eliminando examen");
  }
}

function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/api/")) {
    const normalizedBase = API_BASE_URL.replace(/\/$/, "");
    let basePath = "";

    if (/^https?:\/\//i.test(normalizedBase)) {
      try {
        basePath = new URL(normalizedBase).pathname.replace(/\/$/, "");
      } catch {
        basePath = "";
      }
    } else if (normalizedBase.startsWith("/")) {
      basePath = normalizedBase;
    }

    let normalizedPath = path;

    if (basePath && normalizedPath.startsWith(`${basePath}/`)) {
      normalizedPath = normalizedPath.slice(basePath.length);
    }

    return `${normalizedBase}${normalizedPath}`;
  }
  return path;
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </article>
  );
}

function DataCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{text}</p>;
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}








