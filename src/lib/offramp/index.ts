import { OfframpProvider } from "./types";
import { SandboxOfframpProvider } from "./sandbox";
import { KotaniPayProvider } from "./kotani";

export * from "./types";
export * from "./sandbox";
export * from "./kotani";

let _defaultProvider: OfframpProvider | null = null;

export function getOfframpProvider(): OfframpProvider {
  if (!_defaultProvider) {
    if (process.env.KOTANI_API_KEY) {
      _defaultProvider = new KotaniPayProvider();
    } else {
      _defaultProvider = new SandboxOfframpProvider();
    }
  }
  return _defaultProvider;
}
