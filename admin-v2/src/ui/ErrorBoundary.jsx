import { Component } from 'react';
import { Button } from '../components/ui/button.jsx';

// После деплоя открытая вкладка держит старый index-*.js и лениво тянет чанк со старым хэшем —
// сервер отдаёт 404 и раздел падает. Лечится одной перезагрузкой (новый index подтянет новые
// чанки), поэтому делаем её автоматически. Один раз на вкладку: если не помогло — проблема
// не в устаревшем бандле, и автоперезагрузка превратилась бы в цикл.
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

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
    if (isStaleChunkError(error)) {
      reloadOnceForNewBuild();
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 max-w-xl mx-auto mt-16 rounded-2xl border border-rose-200 bg-rose-50 text-sm text-rose-800 space-y-3">
          <div className="font-bold text-base">Экран упал с ошибкой</div>
          <p className="font-mono text-xs break-all">{String(this.state.error)}</p>
          <p className="text-xs">Остальные разделы работают. Попробуй перезагрузить экран.</p>
          <Button size="sm" className="rounded-xl" type="button" onClick={() => this.setState({ error: null })}>
            Перезагрузить экран
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
