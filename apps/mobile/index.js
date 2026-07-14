import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent statt expo/AppEntry: im pnpm-Monorepo liegt "expo"
// im Root-node_modules, der implizite AppEntry-Import löst dort nicht
// zuverlässig auf.
registerRootComponent(App);
