/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/fb-posts",
        destination: "/feed?platform=facebook",
        permanent: false,
      },
      {
        source: "/alerts",
        destination: "/feed?platform=alerts",
        permanent: false,
      },
      {
        source: "/reddit-posts",
        destination: "/feed?platform=reddit",
        permanent: false,
      },
      {
        source: "/ig-posts",
        destination: "/feed?platform=instagram",
        permanent: false,
      },
      {
        source: "/qiita-items",
        destination: "/feed?platform=qiita",
        permanent: false,
      },
      {
        source: "/gh-items",
        destination: "/feed?platform=github",
        permanent: false,
      },
      {
        source: "/fb-sources",
        destination: "/settings?tab=facebook",
        permanent: false,
      },
      {
        source: "/alert-sources",
        destination: "/settings?tab=alerts",
        permanent: false,
      },
      {
        source: "/reddit-sources",
        destination: "/settings?tab=reddit",
        permanent: false,
      },
      {
        source: "/ig-sources",
        destination: "/settings?tab=instagram",
        permanent: false,
      },
      {
        source: "/qiita-sources",
        destination: "/settings?tab=qiita",
        permanent: false,
      },
      {
        source: "/gh-sources",
        destination: "/settings?tab=github",
        permanent: false,
      },
      {
        source: "/candidates",
        destination: "/settings?tab=candidates",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
