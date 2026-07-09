import React from "react";
import { Composition } from "remotion";
import { PayMageDemo } from "./PayMageDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PayMageDemo"
        component={PayMageDemo}
        durationInFrames={2250}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};