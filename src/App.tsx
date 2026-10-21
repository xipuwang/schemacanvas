import { AppShell } from '@/ui/shell';
import { useEffect } from 'react';
import { startApp } from '@/ui/shell/startup';

export function App() {
  useEffect(() => {
    void startApp();
  }, []);
  return <AppShell />;
}
