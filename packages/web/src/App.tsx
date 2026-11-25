import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useFitTables } from './lib/fitTables';

export default function App() {
  useFitTables();
  return <RouterProvider router={router} />;
}
