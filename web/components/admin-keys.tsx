'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { openKeyStore } from '../lib/key-actions';

type Keys = {
  cdekAccount: string;
  cdekPassword: string;
  javascript: string;
  geocoder: string;
  dadataApi: string;
  dadataSecret: string;
};

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <label>
      {label}
      {value ? <input readOnly value={value} spellCheck={false} autoComplete="off" /> : <span>На этом запуске этого ключа нет.</span>}
    </label>
  );
}

export function AdminKeys() {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();
  const [keys, setKeys] = useState<Keys | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start(async () => {
      const result = await openKeyStore(password);
      if (!result.ok) {
        setKeys(null);
        setNotice(result.message);
        return;
      }
      setNotice('');
      setPassword('');
      setKeys(result.keys);
    });
  }

  return (
    <>
      <h1>Ключи и доступы</h1>
      {keys ? (
        <div className="admin-key-list">
          <section>
            <h2>СДЭК</h2>
            <KeyValue label="Идентификатор" value={keys.cdekAccount} />
            <KeyValue label="Защитный пароль" value={keys.cdekPassword} />
          </section>
          <section>
            <h2>JavaScript</h2>
            <KeyValue label="Ключ JavaScript API" value={keys.javascript} />
          </section>
          <section>
            <h2>Geocoder</h2>
            <KeyValue label="Ключ Геокодера" value={keys.geocoder} />
          </section>
          <section>
            <h2>DaData</h2>
            <KeyValue label="API-ключ" value={keys.dadataApi} />
            <KeyValue label="Секретный ключ" value={keys.dadataSecret} />
          </section>
          <button type="button" className="text-button" onClick={() => setKeys(null)}>Скрыть ключи</button>
        </div>
      ) : (
        <div className="admin-key-gate" role="presentation">
          <form className="admin-key-card" onSubmit={submit}>
            <h2>Открыть ключи</h2>
            <p>Введите пароль, чтобы увидеть СДЭК, JavaScript, Geocoder и DaData.</p>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                autoComplete="off"
                required
              />
            </label>
            <button type="submit" disabled={pending}>{pending ? 'Проверяем' : 'Открыть'}</button>
            {notice ? <p className="account-notice">{notice}</p> : null}
          </form>
        </div>
      )}
    </>
  );
}
