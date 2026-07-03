import { redirect } from "next/navigation";
import { appMode } from "@/server/mode";
import { LoginForm } from "@/app/login/login-form";

/** Team-mode sign-in. In local mode there is nothing to sign in to. */
export default function LoginPage() {
  if (appMode() !== "team") redirect("/");
  return <LoginForm />;
}
