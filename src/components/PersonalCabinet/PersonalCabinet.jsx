import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useSwipeLeftOpen } from '../../hooks/useSwipeLeftOpen';
import styles from './PersonalCabinet.module.css';

const WAITER_API_URL = import.meta.env.VITE_WAITER_API_URL;

function onlyDigits(raw, maxLen) {
  return raw.replace(/\D/g, '').slice(0, maxLen);
}

// Личный кабинет гостя — свайп влево открывает (тот же паттерн, что в
// Waiter-app для меню ресторана: постоянный флажок на краю экрана +
// свайп). Имя/телефон — обязательные поля программы баллов. Смена
// телефона (в том числе самая первая) требует SMS-подтверждения —
// вызывается либо явно самим гостем, либо автоматически, когда сюда
// приводит правильный ответ в викторине (registrationContext).
export default function PersonalCabinet({
  isOpen,
  onOpen,
  onClose,
  guestId,
  deviceId,
  registrationContext, // { questionId, selectedIndex } | null — задаёт вызывающая сторона
  onRegistrationComplete, // (points) => void
}) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [dislikes, setDislikes] = useState('');

  const [smsStep, setSmsStep] = useState('idle'); // 'idle' | 'code-sent'
  const [smsCode, setSmsCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const swipeHandlers = useSwipeLeftOpen(onOpen);

  useEffect(() => {
    if (!isOpen || !guestId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('guests')
        .select('name, phone, points, birthday_day, birthday_month, dislikes')
        .eq('id', guestId)
        .single();
      if (cancelled || !data) return;
      setProfile(data);
      setName(data.name || '');
      setPhoneDigits((data.phone || '').replace(/\D/g, '').slice(-10));
      setBirthdayDay(data.birthday_day ? String(data.birthday_day) : '');
      setBirthdayMonth(data.birthday_month ? String(data.birthday_month) : '');
      setDislikes(data.dislikes || '');
      setError('');
      setSuccessMessage('');
      setSmsStep('idle');
    })();
    return () => { cancelled = true; };
  }, [isOpen, guestId]);

  const phone = phoneDigits.length === 10 ? `+7${phoneDigits}` : '';
  const phoneChanged = !!profile && phone !== (profile.phone || '');
  const isDirty = !!profile && (
    name !== (profile.name || '') ||
    phoneChanged ||
    birthdayDay !== (profile.birthday_day ? String(profile.birthday_day) : '') ||
    birthdayMonth !== (profile.birthday_month ? String(profile.birthday_month) : '') ||
    dislikes !== (profile.dislikes || '')
  );
  const canSave = name.trim() !== '' && phoneDigits.length === 10 && isDirty && !saving;

  const handleClose = () => {
    setSmsStep('idle');
    setSmsCode('');
    setError('');
    setSuccessMessage('');
    onClose();
  };

  const handleSave = async () => {
    if (!canSave) return;
    setError('');
    setSaving(true);
    try {
      if (phoneChanged) {
        if (!WAITER_API_URL) throw new Error('Сервис недоступен, попробуйте позже');
        const res = await fetch(`${WAITER_API_URL}/api/guest/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
        setSmsStep('code-sent');
      } else {
        const { error: rpcError } = await supabase.rpc('update_guest_profile', {
          p_device_id: deviceId,
          p_name: name.trim(),
          p_birthday_day: birthdayDay ? Number(birthdayDay) : null,
          p_birthday_month: birthdayMonth ? Number(birthdayMonth) : null,
          p_dislikes: dislikes.trim() || null,
        });
        if (rpcError) throw rpcError;
        setProfile((prev) => ({
          ...prev,
          name: name.trim(),
          birthday_day: birthdayDay ? Number(birthdayDay) : null,
          birthday_month: birthdayMonth ? Number(birthdayMonth) : null,
          dislikes: dislikes.trim() || null,
        }));
        setSuccessMessage('Сохранено');
        setTimeout(() => setSuccessMessage(''), 2000);
      }
    } catch (e) {
      setError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyCode = async () => {
    if (smsCode.trim().length !== 4 || saving) return;
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`${WAITER_API_URL}/api/guest/verify-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          code: smsCode.trim(),
          deviceId,
          name: name.trim(),
          questionId: registrationContext?.questionId || null,
          selectedIndex: registrationContext?.selectedIndex ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось подтвердить код');

      setProfile((prev) => ({ ...prev, name: name.trim(), phone, points: data.points ?? prev?.points }));
      setSmsStep('idle');
      setSmsCode('');

      if (registrationContext) {
        setSuccessMessage('Готово! Баллы начислены');
        setTimeout(() => {
          onRegistrationComplete?.(data.points);
          handleClose();
        }, 1800);
      } else {
        setSuccessMessage('Номер подтверждён');
        setTimeout(() => setSuccessMessage(''), 2000);
      }
    } catch (e) {
      setError(e.message || 'Не удалось подтвердить код');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <div className={styles.edgeTab} onClick={onOpen} {...swipeHandlers}>
          <span className={styles.edgeTabText}>ПРОФИЛЬ</span>
        </div>
      )}

      {isOpen && (
        <div className={styles.overlay}>
          <div className={styles.panel}>
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Закрыть">✕</button>

            <div className={styles.pointsBlock}>
              <div className={styles.pointsValue}>{profile?.points ?? 0}</div>
              <div className={styles.pointsLabel}>баллов накоплено</div>
            </div>

            {registrationContext && smsStep === 'idle' && (
              <div className={styles.registrationBanner}>
                Чтобы сохранить результат и начислить баллы, подтвердите короткую регистрацию
              </div>
            )}

            {smsStep === 'idle' && (
              <div className={styles.form}>
                <label className={styles.fieldLabel}>Имя</label>
                <input
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ваше имя"
                />

                <label className={styles.fieldLabel}>Телефон</label>
                <div className={styles.phoneRow}>
                  <span className={styles.phonePrefix}>+7</span>
                  <input
                    className={styles.phoneInput}
                    value={phoneDigits}
                    onChange={(e) => setPhoneDigits(onlyDigits(e.target.value, 10))}
                    placeholder="9XX XXX XX XX"
                    inputMode="numeric"
                  />
                </div>

                <label className={styles.fieldLabel}>Дата рождения (без года)</label>
                <div className={styles.birthdayRow}>
                  <input
                    className={styles.birthdayInput}
                    value={birthdayDay}
                    onChange={(e) => setBirthdayDay(onlyDigits(e.target.value, 2))}
                    placeholder="ДД"
                    inputMode="numeric"
                  />
                  <input
                    className={styles.birthdayInput}
                    value={birthdayMonth}
                    onChange={(e) => setBirthdayMonth(onlyDigits(e.target.value, 2))}
                    placeholder="ММ"
                    inputMode="numeric"
                  />
                </div>

                <label className={styles.fieldLabel}>Что вы не едите</label>
                <span className={styles.fieldHint}>Например: кинза, помидоры, арахис</span>
                <textarea
                  className={styles.textarea}
                  value={dislikes}
                  onChange={(e) => setDislikes(e.target.value)}
                  placeholder="Перечислите через запятую"
                />

                {error && <div className={styles.error}>{error}</div>}
                {successMessage && <div className={styles.success}>{successMessage}</div>}

                <button
                  className={`${styles.saveBtn} ${canSave ? styles.saveBtnActive : ''}`}
                  onClick={handleSave}
                  disabled={!canSave}
                >
                  {saving ? '...' : (isDirty ? 'Обновить' : 'Ок')}
                </button>
              </div>
            )}

            {smsStep === 'code-sent' && (
              <div className={styles.form}>
                <p className={styles.smsHint}>Код отправлен на +7{phoneDigits}</p>
                <input
                  className={styles.input}
                  value={smsCode}
                  onChange={(e) => setSmsCode(onlyDigits(e.target.value, 4))}
                  placeholder="Код из SMS"
                  inputMode="numeric"
                />
                {error && <div className={styles.error}>{error}</div>}
                {successMessage && <div className={styles.success}>{successMessage}</div>}
                <button
                  className={`${styles.saveBtn} ${smsCode.length === 4 ? styles.saveBtnActive : ''}`}
                  onClick={handleVerifyCode}
                  disabled={smsCode.length !== 4 || saving}
                >
                  {saving ? '...' : 'Подтвердить'}
                </button>
                <button className={styles.secondaryBtn} onClick={() => setSmsStep('idle')}>
                  Назад
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
