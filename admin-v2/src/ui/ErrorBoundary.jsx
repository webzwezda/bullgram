import { Component } from 'react';
import { Button } from '../components/ui/button.jsx';

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
