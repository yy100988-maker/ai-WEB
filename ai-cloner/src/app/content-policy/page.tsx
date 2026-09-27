import type { Metadata } from "next";
import { LegalDoc } from "@/components/sites/vutu/LegalDoc";

export const metadata: Metadata = {
  title: "Content Policy | Vutu AI",
};

export default function Page() {
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Content Policy"
      intro="This policy covers what may be created, uploaded, or shared through this study-only front-end replica."
      sections={[
        {
          h: "1. Prohibited content",
          p: "Content that is illegal, that infringes others' rights, that endangers people, or that depicts minors in any harmful way is prohibited without exception.",
        },
        {
          h: "2. Rights to your inputs",
          p: "You must own or have permission for every image, prompt, or file you upload. Generated-looking outputs inherit the constraints of your inputs.",
        },
        {
          h: "3. Responsible disclosure",
          p: "Because this is a study replica with placeholder generation, any resemblance between demo output and real media is coincidental and must not be presented as authentic.",
        },
        {
          h: "4. Reporting",
          p: "Report policy violations through the project repository's issue tracker; verified violations are removed and repeat accounts are restricted.",
        },
      ]}
    />
  );
}
