import { WithdrawTickerSection } from "../components/sections/WithdrawTickerSection";
import { StakingPromoSection } from "../components/sections/StakingPromoSection";
import { CalculatorSection } from "../components/sections/CalculatorSection";
import { ServicesSection } from "../components/sections/ServicesSection";
import { AboutSection } from "../components/sections/AboutSection";
import { WhySection } from "../components/sections/WhySection";
import { TeamSection } from "../components/sections/TeamSection";

export function HomePage() {
  return (
    <>
      <WithdrawTickerSection />
      <StakingPromoSection />
      <CalculatorSection />
      <ServicesSection showProofSections={false} />
      <AboutSection showProofSections={false} />
      <WhySection />
      <TeamSection showProofSections={false} />
    </>
  );
}
