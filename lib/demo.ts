export const DEMO_FILENAME = "ebmc-plywood-demo.sbp";

export const DEMO_SBP = `' ShopBot Check synthetic demonstration file
' Generated for East Bay Makers Club — no member design data
' SHOPBOT ROUTER FILE IN INCHES
' Length of material in X = 48.000
' Length of material in Y = 24.000
' Depth of material in Z = 0.700
' Home Position Information = Bottom Left Corner, Material Surface
' Rapid clearance gap or Safe Z = 0.250
' Tool Name = Compression End Mill (1/2")
IF %(25)=1 THEN GOTO UNIT_ERROR
SA
CN, 90
&PWSafeZ = 0.250
&PWZorigin = Material Surface
&PWMaterial = 0.700
&Tool = 1
C9
TR, 18000
C6
PAUSE 2
MS, 4.5, 0.5
JZ, 0.250
J2, 1.000, 1.000
M3, 1.000, 1.000, -0.250
M3, 14.000, 1.000, -0.250
CG, , 15.000, 2.000, 0.000, 1.000, T, -1
M3, 15.000, 9.000, -0.250
CG, , 14.000, 10.000, -1.000, 0.000, T, -1
M3, 1.000, 10.000, -0.250
CG, , 0.000, 9.000, 0.000, -1.000, T, -1
M3, 0.000, 2.000, -0.250
CG, , 1.000, 1.000, 1.000, 0.000, T, -1
M3, 1.000, 1.000, -0.520
M3, 14.000, 1.000, -0.520
CG, , 15.000, 2.000, 0.000, 1.000, T, -1
M3, 15.000, 9.000, -0.520
CG, , 14.000, 10.000, -1.000, 0.000, T, -1
M3, 1.000, 10.000, -0.520
CG, , 0.000, 9.000, 0.000, -1.000, T, -1
M3, 0.000, 2.000, -0.520
CG, , 1.000, 1.000, 1.000, 0.000, T, -1
JZ, 0.250
J3, 0.000, 0.000, 0.250
C7
END

UNIT_ERROR:
CN, 91
END
`;
