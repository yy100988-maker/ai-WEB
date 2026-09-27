import type { Metadata } from "next";
import { LegalDoc } from "@/components/sites/vutu/LegalDoc";

export const metadata: Metadata = {
  title: "Contact Us | Vutu AI",
};

export default function Page() {
  return (
    <LegalDoc
      eyebrow="Company"
      title="Contact Us"
      intro="This is an unofficial study replica, so it has no live support desk — but feedback, bug reports, and takedown requests are all welcome."
      sections={[
        {
          h: "How to reach us",
          p: "Open an issue in the project repository. Reports are triaged in the order they arrive; security-sensitive issues should be flagged as such in the title.",
        },
        {
          h: "What to include",
          p: "For layout bugs: page URL, viewport size, and a screenshot. For content concerns: the exact section and the reason it should change.",
        },
        {
          h: "Response time",
          p: "Typical turnaround is within a few working days. This replica has no phone line, no chat desk, and no billing support.",
        },
      ]}
    />
  );
}
