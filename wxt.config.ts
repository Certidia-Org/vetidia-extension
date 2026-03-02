import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  extensionApi: "chrome",
  manifest: {
    name: "Vetidia — Smart Job Application Autofill",
    description:
      "AI-powered job application autofill. Fill forms intelligently from your Vetidia career vault.",
    version: "0.3.0",
    permissions: [
      "activeTab",
      "scripting",
      "storage",
      "identity",
      "tabs",
      "alarms",
      "sidePanel",
      "contextMenus",
    ],
    host_permissions: [
      "https://boards.greenhouse.io/*",
      "https://job-boards.greenhouse.io/*",
      "https://jobs.lever.co/*",
      "https://apply.lever.co/*",
      "https://*.myworkdayjobs.com/*",
      "https://*.myworkdaysite.com/*",
      "https://*.icims.com/*",
      "https://*.ashbyhq.com/*",
      "https://*.smartrecruiters.com/*",
      "https://*.linkedin.com/*",
      "https://*.taleo.net/*",
      "https://*.breezy.hr/*",
      "https://*.bamboohr.com/*",
      "https://*.jazz.co/*",
      "https://*.jobvite.com/*",
      "https://*.recruitee.com/*",
      "https://*.workable.com/*",
    ],
    oauth2: {
      client_id: "115303579766-sd79bt349f3t2abrn6s176bvaq46oirj.apps.googleusercontent.com",
      scopes: ["openid", "email", "profile"],
    },
  },
  webExt: {
    startUrls: ["https://boards.greenhouse.io/"],
  },
});
