import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ServiceMapStore } from "../../common/store/map-store";

const { Checkbox } = Renderer.Component;

export const DefaultPaletteInput = observer(() => {
  const store = ServiceMapStore.getInstance<ServiceMapStore>();
  return (
    <Checkbox
      label="Color-blind safe palette by default"
      value={store.defaultPalette === "cb"}
      onChange={(v) => {
        store.defaultPalette = v ? "cb" : "default";
      }}
    />
  );
});

export const PaletteHint = () => <span>Per-cluster settings are on the map page (Settings).</span>;
