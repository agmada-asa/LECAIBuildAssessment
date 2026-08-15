/**
 * @file Unit tests verifying cursor styling across buttons and pressable primitives.
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

describe("Button and pressable cursor styling", () => {
  it("includes cursor-pointer in button variant classes", () => {
    expect(buttonVariants()).toContain("cursor-pointer");
    expect(buttonVariants({ variant: "outline" })).toContain("cursor-pointer");
    expect(buttonVariants({ variant: "ghost" })).toContain("cursor-pointer");
    expect(buttonVariants({ variant: "secondary" })).toContain("cursor-pointer");
    expect(buttonVariants({ variant: "destructive" })).toContain("cursor-pointer");
    expect(buttonVariants({ variant: "link" })).toContain("cursor-pointer");
  });

  it("renders Button element with cursor-pointer class", () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toHaveClass("cursor-pointer");
  });

  it("renders Switch primitive with cursor-pointer class", () => {
    render(<Switch aria-label="Toggle setting" />);
    const switchEl = screen.getByRole("switch", { name: "Toggle setting" });
    expect(switchEl).toHaveClass("cursor-pointer");
  });

  it("renders TabsTrigger with cursor-pointer class", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "Tab 1" });
    expect(tab).toHaveClass("cursor-pointer");
  });

  it("renders SelectTrigger with cursor-pointer class", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Choose item">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Choose item" });
    expect(trigger).toHaveClass("cursor-pointer");
  });

  it("renders SelectItem with cursor-pointer class", () => {
    render(
      <Select open>
        <SelectTrigger aria-label="Choose item">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="opt1">Option 1</SelectItem>
        </SelectContent>
      </Select>,
    );
    const option = screen.getByRole("option", { name: "Option 1" });
    expect(option).toHaveClass("cursor-pointer");
  });

  it("renders DropdownMenuItem with cursor-pointer class", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<Button>Open Menu</Button>} />
        <DropdownMenuContent>
          <DropdownMenuItem>Menu Action</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menuItem = screen.getByRole("menuitem", { name: "Menu Action" });
    expect(menuItem).toHaveClass("cursor-pointer");
  });
});
