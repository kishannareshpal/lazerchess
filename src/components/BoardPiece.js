import React, { useEffect, useState, useCallback } from "react";
import { isEqual, toPlainObject } from "lodash";
import Konva from "konva";
import Location from "../models/Location";
import Movement from "../models/Movement";
import useImage from "use-image";
import Engine from "../utils/Engine";
import { MovementTypesEnum, PieceTypesEnum } from "../models/Enums";
import { Image } from "react-konva";


const pieceAnimDuration = 0.332;

const BoardPiece = ({ id, square: { piece, location }, board, onMove, onSelect, gridSize, turn, laserIsTriggered }) => {

	const [lastXY, setLastXY] = useState({ x: undefined, y: undefined });
	const [pieceImage] = useImage(`https://laserchess.s3.us-east-2.amazonaws.com/pieces/${piece.imageName}.svg`);

	/**
	 * Determine the piece size according to the grid 
	 * and the given margin for the piece inside the grid.
	 */
	const getPieceSize = useCallback(() => {
		return gridSize;
	}, [gridSize]);

	/**
	 * Determine the X position of the piece in the grid,
	 * according to the given column, and taking in
	 * consideration the piece size.
	 */
	const getX = useCallback(() => {
		return (location.colIndex * gridSize) + Math.floor(getPieceSize() / 2);
	}, [getPieceSize, gridSize, location.colIndex]);

	/**
	 * Determine the Y position of the piece in the grid,
	 * according to the given row, and taking in
	 * consideration the piece size.
	 */
	const getY = useCallback(() => {
		return (location.rowIndex * gridSize) + Math.floor(getPieceSize() / 2);
	}, [getPieceSize, gridSize, location.rowIndex]);


	useEffect(() => {
		const xy = {
			x: getX(),
			y: getY()
		};
		setLastXY(xy);
	}, [getX, getY]);


	/**
	 * Converts the 0-indexed xy coordinates into Location.
	 * 
	 * @param {Number} x the x index (0-9) // column
	 * @param {Number} y the y index (0-7) // row
	 * @returns {Location} the location calculated from the xy index
	 */
	const xyToLocation = useCallback((x, y) => {
		// First transform the x and y to column and array index (the one we use for arrays)
		const colIndex = Math.floor((x / gridSize));
		const rowIndex = Math.floor((y / gridSize));
		const pieceLocation = new Location(colIndex, rowIndex);
		return pieceLocation;
	}, [gridSize]);

	return (
		<Image draggable={piece.type !== PieceTypesEnum.LASER}
			id={id}
			onClick={(e) => {
				// Prevent selection on a lser piece
				if (piece.type !== PieceTypesEnum.LASER) {
					onSelect(location); // location (aka srcLocation) of the clicked peace
				}
			}}
			onDblClick={(e) => {
				// Rotate 90 degrees clockwise.
				const currentOrientation = e.target.rotation();
				let newOrientation;
				if (currentOrientation === 270) {
					newOrientation = 0; // reset the rotation.. basically rotates to 360º but we use 0º instead, to conform to our guidelines.
				} else {
					newOrientation = currentOrientation + 90; // rotate 90 degrees from current orientation.
				}

				e.target.rotation(newOrientation);

				const srcLocation = xyToLocation(lastXY.x, lastXY.y);
				// TODO: Implement counter-clockwise rotation.
				const movement = toPlainObject(new Movement(MovementTypesEnum.ROTATION_CLOCKWISE, toPlainObject(srcLocation)));
				onSelect(null); // location (aka srcLocation) of the clicked peace
				onMove(movement);
			}}
			dragBoundFunc={(pos) => {
				// Limit drag to inside the canvas.
				const firstSquare = getPieceSize() - (getPieceSize() / 2);
				const lastColHor = (getPieceSize() * 9) + (getPieceSize() / 2);
				const lastColVer = (getPieceSize() * 7) + (getPieceSize() / 2);
				const newX = pos.x > lastColHor ? lastColHor : pos.x < firstSquare ? firstSquare : pos.x;
				const newY = pos.y > lastColVer ? lastColVer : pos.y < firstSquare ? firstSquare : pos.y;
				return {
					x: newX,
					y: newY
				};
			}}
			onDragStart={(e) => {
				e.target.moveToTop(); // Move up the layer, so it doesn't get hidden beneath other Nodes (pieces)
			}}
			onDragEnd={(e) => {
				onSelect(null); // Unselect the piece

				// Handle piece drag and dropping by snapping it to the grid.
				const rawEndX = e.target.x(); // the final X position
				const rawEndY = e.target.y(); // the final Y position
				// Calculate the X and Y used to draw the piece in the board. Having in consideration the margin and the piece offset.
				const endX = (Math.round((rawEndX + (gridSize / 2)) / gridSize) * gridSize) - (gridSize / 2);
				const endY = (Math.round((rawEndY + (gridSize / 2)) / gridSize) * gridSize) - (gridSize / 2);

				// TODO: check if this move was valid then update the board arrangement!
				const hasChangedLocation = !isEqual(lastXY, { x: endX, y: endY });
				if (hasChangedLocation) {
					const srcLocation = xyToLocation(lastXY.x, lastXY.y);
					const destLocation = xyToLocation(endX, endY);

					// Validate!
					// Check if the destLocation square is a neighbor of the srcLocation.
					const isMovingToNeighbor = Engine.isMovingToNeighbor(srcLocation, destLocation);
					if (!isMovingToNeighbor) {
						// Not a neighbor square of the srcLocation, so move is invalid by itself.
						// See game rules about piece movement https://github.com/kishannareshpal/docs/Guide.md

						// Reset the piece to where it was before moving.
						e.target.to({
							x: lastXY.x,
							y: lastXY.y,
							duration: pieceAnimDuration,
							easing: Konva.Easings.BackEaseOut
						});

					} else {
						// We are moving to a neighbor, which is a valid move location.
						// But, now we check if we are not stepping into another piece (moving to a square where another piece already exists is only valid for a Switch piece)
						const movePossibility = Engine.checkMovePossibility(srcLocation, destLocation, board);
						console.log(movePossibility);

						if (!movePossibility.isPossible) {
							// Oh-no, the movement is not possible!
							// The dest location already contains a piece on it and the srcPiece is not a Shield.
							// Or the destLocation is not a neighboring square.
							// Reset the piece to where it was before drag (to it's original location - src).
							e.target.to({
								x: lastXY.x,
								y: lastXY.y,
								duration: pieceAnimDuration,
								easing: Konva.Easings.BackEaseOut
							});

						} else {
							// Perfect! The movement is possible
							// Check the type of movement, which could be either "special" or "normal"
							if (movePossibility.type === MovementTypesEnum.SPECIAL) {
								// Special move (Switch can swap)
								// Swap the piece from destLocation with the current piece!
								e.target.to({
									x: endX,
									y: endY,
									duration: pieceAnimDuration,
									easing: Konva.Easings.BackEaseOut
								});

								// Replaces the srcPiece with the destPiece and vice versa.
								const movement = toPlainObject(new Movement(MovementTypesEnum.SPECIAL, toPlainObject(srcLocation), toPlainObject(destLocation)));
								// Pass the lastXY so we can animate the move of the destPiece to the srcLocation (the switch)!
								onMove(movement, lastXY);

							} else if (movePossibility.type === MovementTypesEnum.NORMAL) {
								// Normal move (moving to a new empty target square)
								e.target.to({
									x: endX,
									y: endY,
									duration: pieceAnimDuration,
									easing: Konva.Easings.BackEaseOut
								});

								const movement = new Movement(MovementTypesEnum.NORMAL, toPlainObject(srcLocation), toPlainObject(destLocation));
								onMove(toPlainObject(movement));

							}

							// Update the last position to be this new one
							setLastXY({
								x: endX,
								y: endY
							});
						}
					}

				} else {
					// No movement made at all. Just align back to where it was before drag.
					e.target.to({
						x: endX,
						y: endY,
						duration: pieceAnimDuration,
						easing: Konva.Easings.BackEaseOut
					});
				}
			}}
			offset={{
				x: getPieceSize() / 2,
				y: getPieceSize() / 2,
			}}
			image={pieceImage}
			rotation={piece.orientation}
			listening={(piece.color === turn) && (!laserIsTriggered)}
			x={getX()} // 0.5 because of the stroke of the slot that is 1 centered
			y={getY()} // 0.5 because of the stroke of the slot that is 1 centered
			width={getPieceSize()}
			height={getPieceSize()}
		/>
	);
};

export default BoardPiece;