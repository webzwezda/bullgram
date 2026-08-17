import { useEffect, useRef } from 'react';

let callbackSeq = 0;

export function TelegramLoginWidget({ botUsername, onAuth, size = 'large', radius = 12 }) {
  const containerRef = useRef(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !botUsername) return undefined;

    // виджет резолвит колбэк по имени глобальной функции — на странице
    // может быть несколько инстансов, поэтому имя уникальное
    callbackSeq += 1;
    const callbackName = `onTelegramWidgetAuth${callbackSeq}`;
    window[callbackName] = (user) => onAuthRef.current?.(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', size);
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-radius', String(radius));
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', callbackName);
    container.appendChild(script);

    return () => {
      delete window[callbackName];
      container.innerHTML = '';
    };
  }, [botUsername, size, radius]);

  if (!botUsername) return null;
  return <div ref={containerRef} />;
}
