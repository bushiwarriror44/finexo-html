import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AuthModal } from "./auth/AuthModal";
import { HeroSection } from "./sections/HeroSection";
import { Header } from "./layout/Header";
import { Footer } from "./layout/Footer";
import { SupportChatWidget } from "./support/SupportChatWidget";

export function SiteLayout() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    if (isHome) {
      document.body.classList.remove("sub_page");
    } else {
      document.body.classList.add("sub_page");
    }
  }, [isHome]);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 260);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div className="hero_area">
        <div className="hero_bg_box">
          <div className="bg_img_box">
            <img src="/images/hero-bg.png" alt="" />
          </div>
        </div>
        <Header />
        {isHome ? <HeroSection /> : null}
      </div>
      <Outlet />
      {showScrollTop ? (
        <button
          className="scroll-top-fab"
          type="button"
          aria-label="Scroll to top"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            })
          }
        >
          <i className="fa fa-arrow-up" aria-hidden="true" />
        </button>
      ) : null}
      <AuthModal />
      <SupportChatWidget />
      <Footer />
    </>
  );
}
