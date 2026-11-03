import {afterEach,expect,it,vi} from "vitest";
import {characterRefCardsEnabled} from "@/lib/h3SpecialModes/characterRefCardAvailability";
import {requireTestLab} from "@/lib/experiments/store";
afterEach(()=>vi.unstubAllEnvs());
it("enables promoted character cards separately without opening the Testing routes",()=>{
  vi.stubEnv("OTG_ENV","prod");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","");expect(characterRefCardsEnabled()).toBe(false);
  vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");expect(characterRefCardsEnabled()).toBe(true);expect(()=>requireTestLab()).toThrow("Not found");expect(process.env.OTG_ENV).toBe("prod");
});
it("retains TEST access but does not enable unknown environments",()=>{
  vi.stubEnv("OTG_ENV","test");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","");expect(characterRefCardsEnabled()).toBe(true);
  vi.stubEnv("OTG_ENV","development");vi.stubEnv("OTG_H3_CHARACTER_REFCARDS_ENABLED","1");expect(characterRefCardsEnabled()).toBe(false);
});
