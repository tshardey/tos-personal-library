import type { ButtonHTMLAttributes } from "react";
import { buttonClass, type Size, type Variant } from "./button-styles";

export function Button({
  variant,
  size,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`.trim()} {...rest} />;
}
