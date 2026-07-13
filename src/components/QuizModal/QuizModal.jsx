import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import styles from './QuizModal.module.css';

const CONTEXT_TEXT = {
  pay: 'Пока мы формируем вам чек, поучаствуйте в нашей викторине, наберите 100 баллов и получите бесплатный ужин или обед на двоих, в одном из ресторанов с RestAI',
  waiter: 'Пока официант несёт вам чек, поучаствуйте в нашей викторине, наберите 100 баллов и получите бесплатный ужин или обед на двоих, в одном из ресторанов с RestAI',
};

// Показывается ДО экрана чек/оплата (trigger='pay') или ДО экрана оценки
// ресторана (trigger='waiter'), сразу как гость выбрал способ рассчитаться.
// Отказ, неверный ответ и "вопросов не осталось" — все три ведут к одному
// и тому же onDone (просто продолжаем прерванный поток без начисления
// баллов). Верный ответ — отдельный путь: очки начисляются только после
// SMS-регистрации в личном кабинете, здесь мы лишь передаём вопрос дальше.
export default function QuizModal({ isOpen, trigger, guestId, onDone, onCorrectAnswer }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'question' | 'wrong' | 'empty'
  const [question, setQuestion] = useState(null);
  const [correctText, setCorrectText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setStatus('loading');
    setQuestion(null);

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
      setStatus('question');
    })();

    return () => { cancelled = true; };
  }, [isOpen, guestId]);

  if (!isOpen) return null;

  // Банк вопросов пуст или гость ещё не идентифицирован — не задерживаем.
  if (status === 'empty') {
    onDone();
    return null;
  }

  const handleAnswer = async (index) => {
    if (submitting || !question) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('check_quiz_answer', {
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
        setStatus('wrong');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {status === 'loading' && (
          <div className={styles.loading}>Загрузка вопроса…</div>
        )}

        {status === 'question' && question && (
          <>
            <p className={styles.context}>{CONTEXT_TEXT[trigger] || CONTEXT_TEXT.pay}</p>

            <div className={styles.pointsBadge}>+{question.points} баллов</div>

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
      </div>
    </div>
  );
}
