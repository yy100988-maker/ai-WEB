import type { Metadata } from "next";
import { LegalDoc } from "@/components/sites/vutu/LegalDoc";

export const metadata: Metadata = {
  title: "Terms of Service | Vutu AI",
};

export default function Page() {
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms describe how this study-only front-end replica may be used. By browsing this site you agree to use it for evaluation, research, and demonstration purposes only."
      sections={[
        {
          h: "1. What this site is",
          p: "This is an unofficial front-end replica built for layout and interaction study. It does not operate generation, billing, accounts, or support channels of any real service.",
        },
        {
          h: "2. Acceptable use",
          p: "Do not attempt to abuse, scrape at scale, or misrepresent this replica as an official product. Automated access should respect robots.txt and reasonable request rates.",
        },
        {
          h: "3. Intellectual property",
          p: "Layout, copy, and code on this replica exist for study. Brand names and trademarks belong to their respective owners. If you are a rights holder and want content removed, open an issue in the project repository and it will be taken down promptly.",
        },
        {
          h: "4. No warranties",
          p: "The replica is provided as-is, without warranty of any kind. Generated-looking content is placeholder data and carries no service-level commitment.",
        },
        {
          h: "5. Changes",
          p: "These terms may be updated as the replica evolves. Continued use after an update means you accept the revised terms.",
        },
        {
          h: "6. Contact",
          p: "Questions about these terms go through the project repository's issue tracker, or see the Contact page for the replica's contact channel.",
        },
      ]}
    />
  );
}
