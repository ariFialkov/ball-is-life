// Court geometry in metres (NBA regulation). X runs along the court length,
// Z across the width, Y up. Baskets sit at x = +/- RIM_X.
export const COURT_LENGTH = 28.65;
export const COURT_WIDTH = 15.24;
export const HALF_L = COURT_LENGTH / 2;
export const HALF_W = COURT_WIDTH / 2;
export const RIM_X = HALF_L - 1.575;
export const RIM_H = 3.05;
export const RIM_R = 0.2286;
export const RIM_TUBE = 0.016;
export const BACKBOARD_X = HALF_L - 1.22;
export const BACKBOARD_W = 1.83;
export const BACKBOARD_H = 1.07;
export const BACKBOARD_BOTTOM = 2.9;
export const THREE_R = 7.24;
export const THREE_CORNER_Z = 6.71;
export const FT_LINE_DIST = 5.79; // from baseline
export const KEY_W = 4.88;
export const BALL_R = 0.121;
export const GRAVITY = -9.81;
export const APRON = 1.6; // out-of-bounds walkable margin

export const PLAYER_RADIUS = 0.42;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 6.6;
