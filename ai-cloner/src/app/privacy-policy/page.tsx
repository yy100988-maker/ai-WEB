import type { Metadata } from "next";
import { LegalDoc } from "@/components/sites/vutu/LegalDoc";

export const metadata: Metadata = {
  title: "Privacy Policy | Vutu AI",
};

export default function Page() {
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains what this study-only front-end replica stores, what it does not, and how you stay in control."
      sections={[
        {
          h: "1. What we store",
          p: "Only what the demo needs: your language preference and login state are kept in your own browser (localStorage/cookies). The replica backend stores the account data you explicitly create — email and profile — plus the demo assets you upload.",
        },
        {
          h: "2. What we never do",
          p: "No selling of personal data, no third-party advertising trackers, and no reading of your credentials on other sites. Uploaded images are used only for the demo flows you trigger.",
        },
        {
          h: "3. Retention",
          p: "Demo data follows the replica's retention settings and can be deleted at any time from your profile; clearing browser storage removes local session state immediately.",
        },
        {
          h: "4. Your rights",
          p: "You can request access, correction, or deletion of the account data you created through the contact channel on the Contact page.",
        },
        {
          h: "5. Changes",
          p: "Updates to this policy will be published on this page with a revised date.",
        },
      ]}
    />
  );
}
