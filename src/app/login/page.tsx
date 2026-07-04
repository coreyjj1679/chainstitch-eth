import { connection } from "next/server";
import { redirect } from "next/navigation";
import { appMode } from "@/server/mode";
import { LoginForm } from "@/app/login/login-form";

/** Team-mode sign-in. In local mode there is nothing to sign in to. */
export default async function LoginPage() {
  // APP_MODE is a runtime concern (one image serves both modes); without
  // connection() the build would prerender this page with the mode baked in.
  await connection();
  if (appMode() !== "team") redirect("/");
  return <LoginForm />;
}
