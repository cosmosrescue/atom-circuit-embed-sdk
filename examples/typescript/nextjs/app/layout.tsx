import type { ReactNode } from 'react';

export const metadata = {
  title: 'Atom Circuit Next.js examples',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <main style={{ maxWidth: 600, margin: '40px auto', padding: 16 }}>
          {children}
        </main>
      </body>
    </html>
  );
}
