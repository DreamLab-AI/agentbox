"""Illustrative FIFO queue: two arrivals, then one departure; no TeX or speech."""

from manim import (
    Arrow, DOWN, FadeIn, FadeOut, RIGHT, RoundedRectangle,
    Scene, Text, UP, VGroup,
)


class QueueDemo(Scene):
    def construct(self):
        self.camera.background_color = "#101827"
        # Leave the compositor's upper 19% and lower caption region empty.
        boxes = VGroup(*[
            RoundedRectangle(width=3.1, height=1.1, corner_radius=0.1)
            for _ in range(3)
        ]).arrange(RIGHT, buff=1.0).shift(DOWN * 0.2)
        labels = VGroup(*[
            Text(label, font="Noto Sans", font_size=28).move_to(box)
            for label, box in zip(("Producer", "Queue", "Worker"), boxes)
        ])
        arrows = VGroup(*[
            Arrow(boxes[i].get_right(), boxes[i + 1].get_left(), buff=0.12)
            for i in range(2)
        ])
        count = Text("Waiting: 0", font="Noto Sans", font_size=28)
        count.next_to(boxes[1], DOWN, buff=0.45)
        self.next_section("overview")
        self.add(boxes, labels, arrows, count)
        self.wait(1)

        self.next_section("arrivals")
        tokens = []
        for i in range(2):
            token = VGroup(
                RoundedRectangle(width=0.65, height=0.5, corner_radius=0.06,
                                 fill_color="#E7AB54", fill_opacity=1),
                Text(str(i + 1), font="Noto Sans", font_size=22, color="#101827"),
            ).move_to(boxes[0].get_center() + UP * (1.15 + i * 0.7))
            self.play(FadeIn(token), run_time=0.25)
            destination = boxes[1].get_center() + UP * 1.15 + RIGHT * (i - 0.5) * 0.9
            if i:
                self.play(token.animate.move_to(destination + UP * 0.7), run_time=0.5)
                self.play(token.animate.move_to(destination), run_time=0.25)
            else:
                self.play(token.animate.move_to(destination), run_time=0.75)
            replacement = Text(f"Waiting: {i + 1}", font="Noto Sans", font_size=28)
            replacement.move_to(count)
            self.remove(count)
            count = replacement
            self.add(count)
            self.wait(0.5)
            tokens.append(token)

        self.next_section("departure")
        self.play(tokens[0].animate.shift(UP * 0.7), run_time=0.25)
        self.play(tokens[0].animate.move_to(boxes[2].get_center() + UP * 1.85),
                  run_time=0.5)
        self.play(tokens[0].animate.shift(DOWN * 0.7), run_time=0.25)
        self.remove(count)
        count = Text("Waiting: 1", font="Noto Sans", font_size=28)
        count.next_to(boxes[1], DOWN, buff=0.45)
        self.add(count)
        self.play(FadeOut(tokens[0]), run_time=0.5)
        result = Text("Two arrived. One left. One is waiting.",
                      font="Noto Sans", font_size=26)
        result.next_to(count, DOWN, buff=0.45)
        self.add(result)
        self.wait(1.5)
