import type { Metadata } from "next";
import { LegalDoc } from "@/components/sites/vutu/LegalDoc";

export const metadata: Metadata = {
  title: "Affiliate Program | Vutu AI",
};

export default function Page() {
  return (
    <LegalDoc
      eyebrow="Company"
      title="Join the Affiliate Program"
      intro="Share this study replica with people who care about front-end craft, and earn when they sign up for the real product's plans."
      sections={[
        {
          h: "1. How it works",
          p: "Sign up for the program to receive a personal referral link, share it in your articles, videos, or community posts, and earn a commission when someone completes a purchase through your link.",
        },
        {
          h: "2. What you can earn",
          p: "Commission is a percentage of each qualified order. The exact rate and cookie window are confirmed inside the affiliate dashboard once the program opens for this replica's audience.",
        },
        {
          h: "3. Who it is for",
          p: "Educators, creators, and developers producing honest content about AI video tools. Spam, brand-bidding, and misleading claims are not accepted.",
        },
        {
          h: "4. Payouts",
          p: "Payouts are issued after the refund window closes. Full conditions live in the affiliate dashboard terms.",
        },
      ]}
    />
  );
}
