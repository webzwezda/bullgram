import React from 'react';

// После деплоя открытая вкладка держит старый index-*.js и лениво тянет чанк со старым хэшем —
// сервер отдаёт 404 и страница падает. Одна перезагрузка тянет новый index с новыми чанками,
// поэтому делаем её автоматически. Один раз на вкладку: если не помогло — проблема не в
// устаревшем бандле, и автоперезагрузка превратилась бы в цикл.
const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror/i;
const RELOAD_AT_KEY = 'chunk_reload_at';

function isStaleChunkError(error) {
  const text = `${error?.message || ''}\n${String(error || '')}\n${error?.stack || ''}`;
  return CHUNK_ERROR_PATTERN.test(text);
}

function reloadOnceForNewBuild() {
  try {
    if (sessionStorage.getItem(RELOAD_AT_KEY)) return false;
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  } catch {
    return false; // хранилище недоступно — остаёмся на ручной перезагрузке
  }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info);
    if (isStaleChunkError(error)) {
      reloadOnceForNewBuild();
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
          <div className="text-base font-bold text-slate-900 mb-2">Что-то сломалось</div>
          <p className="text-sm text-slate-500 mb-5">Попробуй перезагрузить страницу — обычно это помогает.</p>
          <button
            type="button"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors"
            onClick={() => window.location.reload()}
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    );
  }
}
