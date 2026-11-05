import { Renderer } from "@freelensapp/extensions";
import svgIcon from "./map.svg?raw";

const {
  Component: { Icon },
} = Renderer;

export function MapIcon(props: Renderer.Component.IconProps) {
  return <Icon {...props} svg={svgIcon} />;
}
