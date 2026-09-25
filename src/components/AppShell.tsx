import { cookies } from 'next/headers';
import { verifySession, AUTH_COOKIE } from '@/lib/auth';
import Sidebar from './Sidebar';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const session = await verifySession(token);

  return (
    <div className="flex min-h-screen">
      <Sidebar username={session?.username ?? ''} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
