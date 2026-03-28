import { lazy, Suspense, useEffect, useState } from 'react';

import { useSelector } from 'react-redux';
import { selectAuth } from '@/redux/auth/selectors';
import { AppContextProvider } from '@/context/appContext';
import PageLoader from '@/components/PageLoader';
import AuthRouter from '@/router/AuthRouter';
import Localization from '@/locale/Localization';
import WelcomeModal from '@/components/WelcomeModal/WelcomeModal';

const STORAGE_KEY = 'idurar_demo_seen';

const ErpApp = lazy(() => import('./ErpApp'));

const DefaultApp = () => (
  <Localization>
    <AppContextProvider>
      <Suspense fallback={<PageLoader />}>
        <ErpApp />
      </Suspense>
    </AppContextProvider>
  </Localization>
);

export default function IdurarOs() {
  const { isLoggedIn } = useSelector(selectAuth);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShowWelcome(true);
    }
  }, []);

  const hideWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem(STORAGE_KEY, '1');
  };

  if (!isLoggedIn)
    return (
      <Localization>
        <WelcomeModal open={showWelcome} onClose={hideWelcome} />
        <AuthRouter />
      </Localization>
    );
  else {
    return <DefaultApp />;
  }
}
