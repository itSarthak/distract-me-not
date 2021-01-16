import { render, fireEvent } from "@testing-library/react";
import NumberInput from "./NumberInput";

it('renders correctly', () => {
  const { asFragment } = render(<NumberInput value={5} />);
  expect(asFragment()).toMatchSnapshot();
});

it('handles value change', () => {
  const handleChange = jest.fn();
  const { getByRole } = render(<NumberInput value={5} onChange={handleChange} />);
  const numberInput = getByRole('spinbutton');
  fireEvent.change(numberInput, { target: { value: 10 } });
  expect(handleChange).toHaveBeenCalledTimes(1);
});
