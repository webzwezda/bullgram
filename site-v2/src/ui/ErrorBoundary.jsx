import React from 'react';

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
            className="inline-flex items-center justify-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors"
            onClick={() => window.location.reload()}
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    );
  }
}
