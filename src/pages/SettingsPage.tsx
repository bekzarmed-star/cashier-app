import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Phone, User } from 'lucide-react';
import { cashierApi } from '../api/cashierApi';
import { useAuth } from '../context/AuthContext';
import { useCashierActor } from '../context/useCashierActor';

export function SettingsPage() {
  const { updateUser } = useAuth();
  const user = useCashierActor();

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdError, setPwdError] = useState('');

  useEffect(() => {
    setName(user?.name || '');
    setPhone(user?.phone || '');
  }, [user?.id, user?.name, user?.phone]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setProfileError('');
    setProfileMsg('');
    const nextName = name.trim();
    if (!nextName) {
      setProfileError('Введите имя');
      return;
    }
    setProfileBusy(true);
    try {
      const updated = await cashierApi.updateProfile({
        cashierId: user.id,
        name: nextName,
        phone: phone.trim(),
      });
      updateUser({
        name: updated.name,
        phone: updated.phone || '',
      });
      setName(updated.name);
      setPhone(updated.phone || '');
      setProfileMsg('Профиль сохранён');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Не удалось сохранить профиль');
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setPwdError('');
    setPwdMsg('');
    if (!currentPassword || !newPassword) {
      setPwdError('Введите текущий и новый пароль');
      return;
    }
    if (newPassword.length < 4) {
      setPwdError('Новый пароль должен быть не короче 4 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('Новый пароль и подтверждение не совпадают');
      return;
    }
    setPwdBusy(true);
    try {
      await cashierApi.updatePassword({
        cashierId: user.id,
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdMsg('Пароль изменён');
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Не удалось изменить пароль');
    } finally {
      setPwdBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>Настройки</h1>
            <p className="muted">Войдите, чтобы изменить профиль</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Настройки</h1>
          <p className="muted">
            Профиль кассира · {user.username}
            {user.branchLabel ? ` · ${user.branchLabel}` : ''}
          </p>
        </div>
      </header>

      <section className="panel narrow">
        <h2>
          <User size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Имя и телефон
        </h2>
        <form onSubmit={(e) => void saveProfile(e)} style={{ marginTop: 12 }}>
          {profileError && <div className="alert error">{profileError}</div>}
          {profileMsg && <div className="alert">{profileMsg}</div>}

          <label className="field">
            <span>Логин</span>
            <input value={user.username} disabled readOnly />
          </label>

          <label className="field">
            <span>Имя</span>
            <div className="input-wrap">
              <User size={16} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ФИО"
                autoComplete="name"
              />
            </div>
          </label>

          <label className="field">
            <span>Телефон</span>
            <div className="input-wrap">
              <Phone size={16} />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 …"
                autoComplete="tel"
              />
            </div>
          </label>

          <button type="submit" className="btn primary" disabled={profileBusy}>
            {profileBusy ? 'Сохранение…' : 'Сохранить профиль'}
          </button>
        </form>
      </section>

      <section className="panel narrow" style={{ marginTop: 16 }}>
        <h2>
          <KeyRound size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Смена пароля
        </h2>
        <form onSubmit={(e) => void savePassword(e)} style={{ marginTop: 12 }}>
          {pwdError && <div className="alert error">{pwdError}</div>}
          {pwdMsg && <div className="alert">{pwdMsg}</div>}

          <label className="field">
            <span>Текущий пароль</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          <label className="field">
            <span>Новый пароль</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <label className="field">
            <span>Подтверждение пароля</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <button type="submit" className="btn primary" disabled={pwdBusy}>
            {pwdBusy ? 'Сохранение…' : 'Изменить пароль'}
          </button>
        </form>
      </section>
    </div>
  );
}
