/** @type {import('next').NextConfig} */
const nextConfig = {
  // npm run dev 화면 왼쪽 아래의 Next.js 개발 표시(N 로고) 숨김. 배포 화면에는 원래 나오지 않음
  devIndicators: false,
  // API에서 읽는 스킬 파일을 배포 번들에 포함
  outputFileTracingIncludes: {
    '/api/generate': ['./skill/**'],
  },
};

export default nextConfig;
