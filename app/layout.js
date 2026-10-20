import './globals.css';

export const metadata = {
  title: '나만의 한글 이름 짓기',
  description: '외국 이름을 입력하면 발음이 비슷한 한글 이름을 추천해 주는 이벤트 페이지의 포트폴리오용 재현 데모',
  robots: { index: false },
  icons: { icon: { url: '/images/loading.svg', type: 'image/svg+xml' } },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* 한중일 글꼴을 함께 쓰기 위해 next/font 대신 링크로 불러옴 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Sans+SC:wght@400;600&family=Noto+Sans+JP:wght@400;600&family=Song+Myung&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
