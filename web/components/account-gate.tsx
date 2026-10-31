'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type View = 'login' | 'register';
type Kind = 'person' | 'company';

export function AccountGate() {
  const [open, setOpen] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!slot.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="login-slot" ref={slot}>
      <button type="button" className="login-open" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Войти
      </button>
      {open && (
        <div className="login-panel">
          <AccountForm />
        </div>
      )}
    </div>
  );
}

const personFields = ['firstName', 'phone', 'email', 'password', 'repeat'] as const;
const companyFields = ['inn', 'company', 'address', 'kpp', 'ogrn', 'contact', 'phone', 'email', 'password', 'repeat'] as const;

function fieldError(name: string, value: string, password: string) {
  const text = value.trim();
  if (!text) return name === 'lastName' ? '' : 'Заполните поле';
  if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'Укажите e-mail';
  if (name === 'inn' && !/^\d{10}$/.test(text)) return 'ИНН — 10 цифр';
  if (name === 'password' && text.length < 6) return 'Не короче 6 знаков';
  if (name === 'repeat' && text !== password) return 'Пароли не совпали';
  return '';
}

export function AccountForm() {
  const [view, setView] = useState<View>('login');
  const [kind, setKind] = useState<Kind>('person');
  const [notice, setNotice] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const formId = useId();
  const fields = kind === 'person' ? personFields : companyFields;
  const ready = fields.every((name) => !fieldError(name, values[name] ?? '', values.password ?? ''));

  return (
    <div className="account-form">
      {view === 'login' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const login = String(data.get('login') ?? '').trim();
            const password = String(data.get('password') ?? '');
            if (!login || !password) {
              setNotice('Введите логин и пароль.');
              return;
            }
            setNotice('Поля на месте, но входа ещё нет: покупателей мы пока не храним. Пароль никуда не отправлен.');
          }}
        >
          <h2>Войти</h2>
          <label htmlFor={`${formId}-login`}>Логин<input id={`${formId}-login`} name="login" autoComplete="username" /></label>
          <label htmlFor={`${formId}-password`}>Пароль<input id={`${formId}-password`} name="password" type="password" autoComplete="current-password" /></label>
          <button type="submit">Войти</button>
          <p className="account-switch">
            Нет аккаунта?{' '}
            <button type="button" className="text-button" onClick={() => { setView('register'); setNotice(''); }}>
              Зарегистрироваться
            </button>
          </p>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            setNotice('Анкета собрана. Записать покупателя пока нельзя: у витрины нет своей базы покупателей. Пароль никуда не отправлен.');
          }}
        >
          <h2>Регистрация</h2>
          <div className="kind-choice" role="radiogroup" aria-label="Кто регистрируется">
            <label className={kind === 'person' ? 'picked' : ''}>
              <input type="radio" name="kind" checked={kind === 'person'} onChange={() => { setKind('person'); setNotice(''); }} />
              Физическое лицо
            </label>
            <label className={kind === 'company' ? 'picked' : ''}>
              <input type="radio" name="kind" checked={kind === 'company'} onChange={() => { setKind('company'); setNotice(''); }} />
              Юридическое лицо
            </label>
          </div>
          {kind === 'person' ? (
            <PersonFields id={formId} values={values} touched={touched} onChange={setValues} onBlur={setTouched} />
          ) : (
            <CompanyFields id={formId} values={values} touched={touched} onChange={setValues} onBlur={setTouched} onLookup={setNotice} />
          )}
          <button type="submit" disabled={!ready}>Зарегистрироваться</button>
          <p className="required-note"><span className="req">*</span> поля, обязательные для заполнения</p>
          <p className="account-switch">
            Уже есть аккаунт?{' '}
            <button type="button" className="text-button" onClick={() => { setView('login'); setNotice(''); }}>
              Войти
            </button>
          </p>
        </form>
      )}
      {notice && <p className="account-notice" role="status">{notice}</p>}
    </div>
  );
}

type FieldProps = {
  id: string;
  values: Record<string, string>;
  touched: Record<string, boolean>;
  onChange: (values: Record<string, string>) => void;
  onBlur: (touched: Record<string, boolean>) => void;
};

function bind(props: FieldProps, name: string) {
  const value = props.values[name] ?? '';
  const error = props.touched[name] ? fieldError(name, value, props.values.password ?? '') : '';
  return {
    value,
    error,
    onChange: (next: string) => props.onChange({ ...props.values, [name]: next }),
    onBlur: () => props.onBlur({ ...props.touched, [name]: true }),
  };
}

function PersonFields(props: FieldProps) {
  const { id } = props;
  return (
    <>
      <RequiredField id={`${id}-first`} label="Имя" autoComplete="given-name" {...bind(props, 'firstName')} />
      <RequiredField id={`${id}-last`} label="Фамилия" required={false} autoComplete="family-name" {...bind(props, 'lastName')} />
      <RequiredField id={`${id}-phone`} label="Телефон" type="tel" autoComplete="tel" {...bind(props, 'phone')} />
      <RequiredField id={`${id}-email`} label="E-mail" type="email" autoComplete="email" {...bind(props, 'email')} />
      <RequiredField id={`${id}-new-password`} label="Пароль" type="password" autoComplete="new-password" {...bind(props, 'password')} />
      <RequiredField id={`${id}-repeat`} label="Пароль ещё раз" type="password" autoComplete="new-password" {...bind(props, 'repeat')} />
    </>
  );
}

function CompanyFields(props: FieldProps & { onLookup: (message: string) => void }) {
  const { id, onLookup } = props;
  const inn = bind(props, 'inn');
  return (
    <>
      <RequiredField id={`${id}-inn`} label="ИНН" inputMode="numeric" maxLength={10} autoComplete="off" {...inn} aside={
        <button
          type="button"
          className="inn-lookup"
          aria-label="Подставить реквизиты по ИНН"
          onClick={() => {
            const value = (props.values.inn ?? '').trim();
            if (!/^\d{10}$/.test(value)) {
              props.onBlur({ ...props.touched, inn: true });
              onLookup('Сначала введите ИНН из 10 цифр, потом нажмите значок рядом.');
              return;
            }
            onLookup('Значок на месте. Справочник организаций ещё не подключён, поэтому название, адрес, КПП и ОГРН сами не подставятся. Введите их вручную.');
          }}
        >
          <LookupMark />
        </button>
      } />
      <RequiredField id={`${id}-company`} label="Название" autoComplete="organization" {...bind(props, 'company')} />
      <RequiredField id={`${id}-address`} label="Юридический адрес" autoComplete="street-address" {...bind(props, 'address')} />
      <RequiredField id={`${id}-kpp`} label="КПП" autoComplete="off" {...bind(props, 'kpp')} />
      <RequiredField id={`${id}-ogrn`} label="ОГРН" autoComplete="off" {...bind(props, 'ogrn')} />
      <RequiredField id={`${id}-contact`} label="Контактное лицо" autoComplete="name" {...bind(props, 'contact')} />
      <RequiredField id={`${id}-phone`} label="Телефон" type="tel" autoComplete="tel" {...bind(props, 'phone')} />
      <RequiredField id={`${id}-email`} label="E-mail" type="email" autoComplete="email" {...bind(props, 'email')} />
      <RequiredField id={`${id}-new-password`} label="Пароль" type="password" autoComplete="new-password" {...bind(props, 'password')} />
      <RequiredField id={`${id}-repeat`} label="Пароль ещё раз" type="password" autoComplete="new-password" {...bind(props, 'repeat')} />
    </>
  );
}

function RequiredField({
  id, label, required = true, type = 'text', autoComplete, inputMode, maxLength, value, error, onChange, onBlur, aside,
}: {
  id: string;
  label: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric';
  maxLength?: number;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  aside?: ReactNode;
}) {
  return (
    <label htmlFor={id} className={error ? 'field-error' : undefined}>
      <span>{label}{required ? <> <abbr className="req" title="обязательное поле">*</abbr></> : null}</span>
      {aside ? (
        <span className="inn-row">
          <input id={id} type={type} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
          {aside}
        </span>
      ) : (
        <input id={id} type={type} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      )}
      {error && <span className="field-error-text">{error}</span>}
    </label>
  );
}

function LookupMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M14.5 14.5L20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
