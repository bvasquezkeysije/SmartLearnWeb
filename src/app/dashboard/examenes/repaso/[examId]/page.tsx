"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type SessionUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  roles: string[];
  token: string;
};

type ExamSummary = {
  id: number;
  name: string;
  practiceFeedbackEnabled?: boolean | null;
  practiceOrderMode?: string | null;
  practiceRepeatUntilCorrect?: boolean | null;
};

type ExamQuestion = {
  id: number;
  questionText: string;
  questionType: string;
  correctAnswer?: string | null;
  explanation?: string | null;
  points?: number | null;
  temporizadorSegundos?: number | null;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  correctOption?: string | null;
};

type PracticeStatus = "correct" | "incorrect" | "unanswered";

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase();
}

function resolveCorrectOption(question: ExamQuestion): "a" | "b" | "c" | "d" {
  const value = (question.correctOption ?? "a").toLowerCase();
  if (value === "b" || value === "c" || value === "d") {
    return value;
  }
  return "a";
}

export default function ExamPracticePage() {
  const router = useRouter();
  const params = useParams<{ examId: string }>();
  const examId = Number(params.examId);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [exam, setExam] = useState<ExamSummary | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"a" | "b" | "c" | "d" | null>(null);
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<PracticeStatus | null>(null);
  const [results, setResults] = useState<Record<number, PracticeStatus>>({});
  const [feedbackMode, setFeedbackMode] = useState<"with_feedback" | "without_feedback">("with_feedback");
  const [orderMode, setOrderMode] = useState<"ordered" | "random">("ordered");
  const [progressMode, setProgressMode] = useState<"repeat_until_correct" | "allow_incorrect_pass">("repeat_until_correct");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!Number.isFinite(examId) || examId <= 0) {
        setError("Examen invalido.");
        setLoading(false);
        return;
      }

      const token = localStorage.getItem("smartlearn_token");
      const userRaw = localStorage.getItem("smartlearn_user");
      if (!token || !userRaw) {
        router.replace("/");
        return;
      }

      try {
        const parsed = JSON.parse(userRaw) as SessionUser;
        const fullUser: SessionUser = { ...parsed, token };
        setUser(fullUser);

        const examList = (await fetchJson(`/api/v1/ia/exams?userId=${fullUser.id}`, token)) as ExamSummary[];
        const selectedExam = examList.find((item) => item.id === examId) ?? null;

        if (!selectedExam) {
          setError("No se encontro el examen.");
          setLoading(false);
          return;
        }

        const configuredFeedbackMode = selectedExam.practiceFeedbackEnabled === false ? "without_feedback" : "with_feedback";
        const configuredOrderMode = selectedExam.practiceOrderMode === "random" ? "random" : "ordered";
        const configuredProgressMode =
          selectedExam.practiceRepeatUntilCorrect === false ? "allow_incorrect_pass" : "repeat_until_correct";

        setExam(selectedExam);
        setFeedbackMode(configuredFeedbackMode);
        setOrderMode(configuredOrderMode);
        setProgressMode(configuredProgressMode);

        const loadedQuestions = (await fetchJson(
          `/api/v1/ia/exams/${selectedExam.id}/manual?userId=${fullUser.id}`,
          token,
        )) as ExamQuestion[];

        if (loadedQuestions.length === 0) {
          setError("Este examen no tiene preguntas para iniciar repaso.");
          setLoading(false);
          return;
        }

        const orderedQuestions =
          configuredOrderMode === "random" ? [...loadedQuestions].sort(() => Math.random() - 0.5) : [...loadedQuestions];

        setQuestions(orderedQuestions);
        setIndex(0);
        setResults({});
        setFeedbackStatus(null);
        setSelectedOption(null);
        setWrittenAnswer("");
        setFinished(false);
      } catch (loadError) {
        if (loadError instanceof Error) {
          setError(loadError.message);
        } else {
          setError("No se pudo iniciar el repaso.");
        }
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [examId, router]);

  const currentQuestion = questions[index] ?? null;

  const stats = useMemo(() => {
    const values = Object.values(results);
    const correct = values.filter((status) => status === "correct").length;
    const incorrect = values.filter((status) => status === "incorrect").length;
    const unanswered = values.filter((status) => status === "unanswered").length;
    const total = questions.length;
    const pending = Math.max(total - values.length, 0);
    return {
      total,
      correct,
      incorrect,
      unanswered: unanswered + pending,
    };
  }, [questions.length, results]);

  const resetInput = () => {
    setSelectedOption(null);
    setWrittenAnswer("");
    setFeedbackStatus(null);
  };

  const moveNext = (nextResults: Record<number, PracticeStatus>) => {
    if (index >= questions.length - 1) {
      setFinished(true);
      setFeedbackStatus(null);
      return;
    }
    setIndex((prev) => prev + 1);
    setResults(nextResults);
    resetInput();
  };

  const submitStep = () => {
    if (!currentQuestion) {
      return;
    }

    let status: PracticeStatus;
    if (currentQuestion.questionType === "multiple_choice") {
      if (!selectedOption) {
        status = "unanswered";
      } else {
        status = resolveCorrectOption(currentQuestion) === selectedOption ? "correct" : "incorrect";
      }
    } else if (!writtenAnswer.trim()) {
      status = "unanswered";
    } else {
      const expected = normalizeAnswer(currentQuestion.correctAnswer ?? "");
      status = normalizeAnswer(writtenAnswer) === expected ? "correct" : "incorrect";
    }

    const nextResults = { ...results, [currentQuestion.id]: status };
    setResults(nextResults);

    if (feedbackMode === "with_feedback") {
      setFeedbackStatus(status);
      return;
    }

    if (progressMode === "repeat_until_correct" && status !== "correct") {
      setFeedbackStatus(status);
      return;
    }

    moveNext(nextResults);
  };

  const continueAfterFeedback = () => {
    if (feedbackStatus == null) {
      return;
    }

    if (progressMode === "repeat_until_correct" && feedbackStatus !== "correct") {
      resetInput();
      return;
    }

    moveNext(results);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 p-4">
        <div className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Cargando repaso...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 p-4">
        <div className="mx-auto max-w-5xl space-y-3 rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/dashboard?section=examenes")}
            className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Volver a examenes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{exam?.name ?? "Repaso"}</h1>
              <p className="mt-1 text-sm text-slate-600">Examen en progreso</p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard?section=examenes")}
              className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Volver a examenes
            </button>
          </div>
        </section>

        {finished ? (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-700">Resultado del repaso.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase text-slate-500">Total</p>
                <p className="text-2xl font-semibold text-slate-900">{stats.total}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <p className="text-xs font-semibold uppercase text-emerald-600">Correctas</p>
                <p className="text-2xl font-semibold">{stats.correct}</p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <p className="text-xs font-semibold uppercase text-rose-600">Incorrectas</p>
                <p className="text-2xl font-semibold">{stats.incorrect}</p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <p className="text-xs font-semibold uppercase text-amber-600">No respondidas</p>
                <p className="text-2xl font-semibold">{stats.unanswered}</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => router.push("/dashboard?section=examenes")}
                className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Reintentar
              </button>
            </div>
          </section>
        ) : currentQuestion ? (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                Pregunta {index + 1} de {questions.length}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                Modo: {feedbackMode === "with_feedback" ? "Verificacion + explicacion" : "Flujo continuo"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                Orden: {orderMode === "random" ? "Aleatorio" : "En orden"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                Avance: {progressMode === "repeat_until_correct" ? "Repetir hasta acertar" : "Pasar aunque este mal"}
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h4 className="text-lg font-semibold text-slate-900">{currentQuestion.questionText}</h4>
              <p className="mt-1 text-xs text-slate-500">
                Puntaje: {currentQuestion.points ?? 1} | Temporizador: {currentQuestion.temporizadorSegundos ?? 0}s
              </p>
            </div>

            {currentQuestion.questionType === "multiple_choice" ? (
              <div className="space-y-2">
                {(
                  [
                    ["a", currentQuestion.optionA],
                    ["b", currentQuestion.optionB],
                    ["c", currentQuestion.optionC],
                    ["d", currentQuestion.optionD],
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
                        checked={selectedOption === key}
                        disabled={feedbackStatus != null}
                        onChange={() => setSelectedOption(key)}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
              </div>
            ) : (
              <textarea
                value={writtenAnswer}
                disabled={feedbackStatus != null}
                onChange={(event) => setWrittenAnswer(event.target.value)}
                placeholder="Tu respuesta"
                className="min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
              />
            )}

            {feedbackStatus ? (
              <div
                className={`rounded-lg border px-3 py-2 text-sm ${
                  feedbackStatus === "correct"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : feedbackStatus === "incorrect"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {feedbackStatus === "correct"
                  ? "Respuesta correcta."
                  : feedbackStatus === "incorrect"
                    ? "Respuesta incorrecta."
                    : "No respondiste esta pregunta."}
              </div>
            ) : null}

            {feedbackMode === "with_feedback" && feedbackStatus ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p className="font-semibold text-slate-800">Explicacion</p>
                <p>{currentQuestion.explanation || "No hay explicacion registrada para esta pregunta."}</p>
                {feedbackStatus !== "correct" ? (
                  <p className="mt-2">
                    <span className="font-semibold">Respuesta correcta:</span>{" "}
                    {currentQuestion.questionType === "multiple_choice"
                      ? (resolveCorrectOption(currentQuestion) === "a"
                          ? currentQuestion.optionA
                          : resolveCorrectOption(currentQuestion) === "b"
                            ? currentQuestion.optionB
                            : resolveCorrectOption(currentQuestion) === "c"
                              ? currentQuestion.optionC
                              : currentQuestion.optionD) || "-"
                      : currentQuestion.correctAnswer || "-"}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => router.push("/dashboard?section=examenes")}
                className="rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Guardar y salir
              </button>
              <button
                type="button"
                onClick={() => {
                  if (feedbackStatus == null) {
                    submitStep();
                    return;
                  }
                  continueAfterFeedback();
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {feedbackStatus == null
                  ? feedbackMode === "with_feedback"
                    ? "Responder"
                    : index >= questions.length - 1
                      ? "Finalizar repaso"
                      : "Siguiente"
                  : progressMode === "repeat_until_correct" && feedbackStatus !== "correct"
                    ? "Reintentar pregunta"
                    : index >= questions.length - 1
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
    </div>
  );
}

async function fetchJson(path: string, token: string) {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "Error consultando API");
  }

  return data;
}
