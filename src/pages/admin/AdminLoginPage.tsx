import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Lock, Shield, Upload, User } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { HOSPITAL_NAME } from '../../api/config';

export function AdminLoginPage() {
  const { admin, login } = useAdminAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (admin) return <Navigate to="/admin" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!keyFile) {
      setError('Загрузите ключ E-imzo для продолжения');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password, keyFile);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа администратора');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page admin-login-page">
      <div className="login-backdrop admin-backdrop" aria-hidden />
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <div className="brand-mark lg admin-mark">
            <Shield size={28} strokeWidth={1.6} />
          </div>
          <h1>{HOSPITAL_NAME}</h1>
          <p>Админ-панель · требуется ключ E-imzo</p>
        </div>

        {error && <div className="alert error">{error}</div>}

        <label className="field">
          <span>Имя администратора</span>
          <div className="input-wrap">
            <User size={16} />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
        </label>

        <label className="field">
          <span>Надёжный пароль</span>
          <div className="input-wrap">
            <Lock size={16} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="Введите пароль администратора"
            />
          </div>
        </label>

        <label className="field">
          <span>Файл ключа E-imzo</span>
          <div className="key-upload">
            <KeyRound size={18} />
            <div className="key-upload-text">
              <strong>{keyFile ? keyFile.name : 'Загрузите .pfx / .p12 / .key'}</strong>
              <span>Цифровой ключ обязателен для доступа администратора</span>
            </div>
            <label className="btn">
              <Upload size={16} />
              Обзор
              <input
                type="file"
                accept=".pfx,.p12,.key,.pem,.crt,.cer,.eimzo"
                hidden
                onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </label>

        <button className="btn primary full" type="submit" disabled={loading}>
          {loading ? 'Проверка ключа…' : 'Войти как админ'}
        </button>

        <p className="hint">
          <Building2 size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Вход кассира: <Link to="/login">рабочая станция</Link>
        </p>
      </form>
    </div>
  );
}
