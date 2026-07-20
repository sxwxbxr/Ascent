import { Component, type ReactNode } from 'react';

import { RecoveryScreen } from './RecoveryScreen';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Fängt Render-Fehler im gesamten App-Baum ab (Boot-Guard). Ohne diese
 * Grenze führt eine Ausnahme während des Starts — z. B. beim Zugriff auf
 * inkompatible lokale Daten nach einem Update — zum harten Absturz mit
 * weissem Bildschirm. Stattdessen zeigen wir den Recovery-Screen mit der
 * Option, die lokale DB zurückzusetzen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.log('[ErrorBoundary] Abgefangener Startfehler:', error?.message ?? error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <RecoveryScreen detail={this.state.error.message} />;
    }
    return this.props.children;
  }
}
