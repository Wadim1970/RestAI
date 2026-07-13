import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import styles from './QuizModal.module.css';

const CONTEXT_TEXT = {
  pay: 'Пока мы формируем вам чек, поучаствуйте в нашей викторине, наберите 100 баллов и получите бесплатный ужин или обед на двоих, в одном из ресторанов с RestAI',
  waiter: 'Пока официант несёт вам чек, поучаствуйте в нашей викторине, наберите 100 баллов и получите бесплатный ужин или обед на двоих, в одном из ресторанов с RestAI',
};

// Показывается ДО экрана чек/оплата (trigger='pay') или ДО экрана оценки
// ресторана (trigger='waiter'), сразу как гость выбрал способ рассчитаться.
// Отказ, неверный ответ, таймаут и "вопросов не осталось" — все ведут к
// одному и тому же onDone (продолжаем прерванный поток без баллов).
// Верный ответ — отдельный путь, баллы начисляются только после
// SMS-регистрации в личном кабинете, здесь мы лишь передаём вопрос дальше.
//
// Начиная с 3-го вопроса гостя сервер даёт всего 20 секунд на ответ
// (get_random_quiz_question возвращает time_limit_seconds). Обратный
// отсчёт здесь — только подсказка в интерфейсе: реальная проверка
// времени всегда на сервере (issued_at против now() в
// check_quiz_answer), подделать локальный таймер бессмысленно.
export default function QuizModal({ isOpen, trigger, guestId, onDone, onCorrectAnswer }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'question' | 'wrong' | 'timeout' | 'empty'
  const [question, setQuestion] = useState(null);
  const [correctText, setCorrectText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const answeredRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setStatus('loading');
    setQuestion(null);
    setTimeLeft(null);

    (async () => {
      const { data, error } = await supabase.rpc('get_random_quiz_question', {
        p_guest_id: guestId,
      });
      if (cancelled) return;
      const row = data?.[0];
      if (error || !row) {
        setStatus('empty');
        return;
      }
      setQuestion(row);
      answeredRef.current = false;
      setTimeLeft(row.time_limit_seconds ?? null);
      setStatus('question');
    })();

    return () => { cancelled = true; };
  }, [isOpen, guestId]);

  const handleAnswer = async (index) => {
    if (submitting || !question || answeredRef.current) return;
    answeredRef.current = true;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('check_quiz_answer', {
        p_guest_id: guestId,
        p_question_id: question.question_id,
        p_selected_index: index,
      });
      const result = data?.[0];
      if (error || !result) {
        onDone();
        return;
      }
      if (result.is_correct) {
        onCorrectAnswer(question.question_id, index);
      } else {
        setCorrectText(result.correct_text || '');
        setStatus(result.is_timeout ? 'timeout' : 'wrong');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Локальный отсчёт секунд + автосдача по истечении — сервер сам
  // решит по факту времени, засчитывать ли это как таймаут.
  useEffect(() => {
    if (status !== 'question' || timeLeft === null) return;
    if (timeLeft <= 0) {
      handleAnswer(-1);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, timeLeft]);

  if (!isOpen) return null;

  // Банк вопросов пуст или гость ещё не идентифицирован — не задерживаем.
  if (status === 'empty') {
    onDone();
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {status === 'loading' && (
          <div className={styles.loading}>Загрузка вопроса…</div>
        )}

        {status === 'question' && question && (
          <>
            <p className={styles.context}>{CONTEXT_TEXT[trigger] || CONTEXT_TEXT.pay}</p>

            <div className={styles.badgeRow}>
              <div className={styles.pointsBadge}>+{question.points} баллов</div>
              {timeLeft !== null && (
                <div className={`${styles.timerBadge} ${timeLeft <= 5 ? styles.timerBadgeUrgent : ''}`}>
                  {timeLeft} сек
                </div>
              )}
            </div>

            <h3 className={styles.question}>{question.question}</h3>

            <div className={styles.options}>
              {question.options.map((opt, i) => (
                <button
                  key={i}
                  className={styles.optionBtn}
                  onClick={() => handleAnswer(i)}
                  disabled={submitting}
                >
                  {opt}
                </button>
              ))}
            </div>

            <button className={styles.declineBtn} onClick={onDone} disabled={submitting}>
              Не участвовать
            </button>
          </>
        )}

        {status === 'wrong' && (
          <div className={styles.wrongBlock}>
            <h3 className={styles.wrongTitle}>Упс, вы ошиблись</h3>
            <p className={styles.wrongText}>
              Правильный ответ: «{correctText}». Но не расстраивайтесь, в следующий раз попробуйте снова!
            </p>
            <button className={styles.continueBtn} onClick={onDone}>
              Продолжить
            </button>
          </div>
        )}

        {status === 'timeout' && (
          <div className={styles.wrongBlock}>
            <h3 className={styles.wrongTitle}>Время вышло</h3>
            <p className={styles.wrongText}>
              Правильный ответ: «{correctText}». В следующий раз постарайтесь ответить чуть быстрее!
            </p>
            <button className={styles.continueBtn} onClick={onDone}>
              Продолжить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
