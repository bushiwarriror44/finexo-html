import { StatsSection } from "../components/sections/StatsSection";
import { StakingPromoSection } from "../components/sections/StakingPromoSection";
import { CalculatorSection } from "../components/sections/CalculatorSection";
import { ServicesSection } from "../components/sections/ServicesSection";
import { AboutSection } from "../components/sections/AboutSection";
import { WhySection } from "../components/sections/WhySection";
import { TeamSection } from "../components/sections/TeamSection";
import { TestimonialsSection } from "../components/sections/TestimonialsSection";

export function HomePage() {
  return (
    <>
      <StatsSection />
      <StakingPromoSection />
      <CalculatorSection />
      <ServicesSection showProofSections={false} />
      <AboutSection showProofSections={false} />
      <WhySection />
      <TeamSection showProofSections={false} />
      <TestimonialsSection />
    </>
  );
}
