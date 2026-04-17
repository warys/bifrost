"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alertDialog";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage, useUpdateProviderMutation } from "@/lib/store";
import { ModelProvider } from "@/lib/types/config";
import { cn } from "@/lib/utils";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { AlertCircle, CheckCircle2, EllipsisIcon, PencilIcon, PlusIcon, TrashIcon, ZapIcon } from "lucide-react";
import { ReactNode, useState } from "react";
import { toast } from "sonner";
import AddNewKeySheet from "../dialogs/addNewKeySheet";

interface Props {
	className?: string;
	provider: ModelProvider;
	headerActions?: ReactNode;
	isKeyless?: boolean;
	providerName?: string;
}

// Key test result state
interface KeyTestResult {
	keyIndex: number;
	loading: boolean;
	success: boolean | null; // null = not tested, true = success, false = failed
	latencyMs: number | null;
	error?: string;
}

interface Props {
	className?: string;
	provider: ModelProvider;
	headerActions?: ReactNode;
	isKeyless?: boolean;
	providerName?: string;
}

// Key test result state
interface KeyTestResult {
	keyIndex: number;
	loading: boolean;
	success: boolean | null; // null = not tested, true = success, false = failed
	latencyMs: number | null;
	error?: string;
}

export default function ModelProviderKeysTableView({ provider, className, headerActions, isKeyless, providerName }: Props) {
	const isVLLM = (providerName ?? "").toLowerCase() === "vllm";
	const entityLabel = isVLLM ? "model" : "key";
	const entityLabelPlural = isVLLM ? "models" : "keys";
	const EntityLabel = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
	const hasUpdateProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const hasDeleteProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Delete);
	const [updateProvider, { isLoading: isUpdatingProvider }] = useUpdateProviderMutation();
	const [showAddNewKeyDialog, setShowAddNewKeyDialog] = useState<{ show: boolean; keyIndex: number } | undefined>(undefined);
	const [showDeleteKeyDialog, setShowDeleteKeyDialog] = useState<{ show: boolean; keyIndex: number } | undefined>(undefined);
	const [testResults, setTestResults] = useState<Map<number, KeyTestResult>>(new Map());

	function handleAddKey(keyIndex: number) {
		setShowAddNewKeyDialog({ show: true, keyIndex: keyIndex });
	}

	// Test key connectivity
	async function handleTestKey(keyIndex: number) {
		const key = provider.keys[keyIndex];
		if (!key) return;

		setTestResults((prev) => new Map(prev).set(keyIndex, { keyIndex, loading: true, success: null, latencyMs: null }));

		const startTime = performance.now();

		try {
			// Build test request using the provider's base URL and key
			const baseUrl = provider.network_config?.base_url || "";
			const apiKey = key.value?.value || "";

			// For Azure/Vertex/Bedrock, use different test endpoints
			let testUrl = `${baseUrl}/v1/models`;
			let headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			if (key.azure_key_config) {
				// Azure uses different endpoint structure
				testUrl = `${key.azure_key_config.endpoint}/openai/models?api-version=2024-02-01`;
				headers["api-key"] = apiKey;
			} else if (key.vertex_key_config || key.bedrock_key_config) {
				// For Vertex/Bedrock, we'll use a simple chat completion test
				testUrl = `${baseUrl}/v1/chat/completions`;
				headers["Authorization"] = `Bearer ${apiKey}`;
			} else {
				// Standard OpenAI-compatible endpoint
				headers["Authorization"] = `Bearer ${apiKey}`;
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

			const response = await fetch(testUrl, {
				method: "GET",
				headers,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);
			const latencyMs = Math.round(performance.now() - startTime);

			if (response.ok) {
				setTestResults((prev) =>
					new Map(prev).set(keyIndex, { keyIndex, loading: false, success: true, latencyMs })
				);
				toast.success(`${EntityLabel} connectivity test passed`, {
					description: `Response time: ${latencyMs}ms`,
				});
			} else {
				const errorText = await response.text().catch(() => "");
				setTestResults((prev) =>
					new Map(prev).set(keyIndex, {
						keyIndex,
						loading: false,
						success: false,
						latencyMs,
						error: `HTTP ${response.status}: ${errorText.slice(0, 100)}`,
					})
				);
				toast.error(`${EntityLabel} connectivity test failed`, {
					description: `HTTP ${response.status} (${latencyMs}ms)`,
				});
			}
		} catch (err: unknown) {
			const latencyMs = Math.round(performance.now() - startTime);
			const errorMessage = err instanceof Error ? err.message : "Unknown error";
			setTestResults((prev) =>
				new Map(prev).set(keyIndex, {
					keyIndex,
					loading: false,
					success: false,
					latencyMs,
					error: errorMessage,
				})
			);
			toast.error(`${EntityLabel} connectivity test failed`, {
				description: errorMessage,
			});
		}
	}

	return (
		<div className={cn("w-full", className)}>
			{showDeleteKeyDialog && (
				<AlertDialog open={showDeleteKeyDialog.show}>
					<AlertDialogContent onClick={(e) => e.stopPropagation()}>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete {EntityLabel}</AlertDialogTitle>
							<AlertDialogDescription>Are you sure you want to delete this {entityLabel}. This action cannot be undone.</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter className="pt-4">
							<AlertDialogCancel onClick={() => setShowDeleteKeyDialog(undefined)} disabled={isUpdatingProvider}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								disabled={isUpdatingProvider || !hasDeleteProviderAccess}
								onClick={() => {
									updateProvider({
										...provider,
										keys: provider.keys.filter((_, index) => index !== showDeleteKeyDialog.keyIndex),
									})
										.unwrap()
										.then(() => {
											toast.success(`${EntityLabel} deleted successfully`);
											setShowDeleteKeyDialog(undefined);
										})
										.catch((err) => {
											toast.error(`Failed to delete ${entityLabel}`, {
												description: getErrorMessage(err),
											});
										});
								}}
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
			{showAddNewKeyDialog && (
				<AddNewKeySheet
					show={showAddNewKeyDialog.show}
					onCancel={() => setShowAddNewKeyDialog(undefined)}
					provider={provider}
					keyIndex={showAddNewKeyDialog.keyIndex}
					providerName={providerName}
				/>
			)}
			<CardHeader className="mb-4 px-0">
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">Configured {entityLabelPlural}</div>
					<div className="flex items-center gap-2">
						{headerActions}
						{!isKeyless && (
							<Button
								disabled={!hasUpdateProviderAccess}
								data-testid="add-key-btn"
								onClick={() => {
									handleAddKey(provider.keys.length);
								}}
							>
								<PlusIcon className="h-4 w-4" />
								Add new {entityLabel}
							</Button>
						)}
					</div>
				</CardTitle>
			</CardHeader>
			{isKeyless ? (
				<div className="text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-sm border py-10 text-center text-sm">
					<p>This is a keyless provider - no API keys are required.</p>
					<p>You can edit the provider configuration using the button above.</p>
				</div>
			) : (
				<div className="w-full rounded-sm border flex flex-col gap-2">
					<Table className="w-full" data-testid="keys-table">
						<TableHeader className="w-full">
							<TableRow>
								<TableHead>{isVLLM ? "Model" : "API Key"}</TableHead>
								<TableHead>Weight</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead>Response Time</TableHead>
								<TableHead className="text-right"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{provider.keys.length === 0 && (
								<TableRow data-testid="keys-table-empty-state">
									<TableCell colSpan={5} className="py-6 text-center">
										No {entityLabelPlural} found.
									</TableCell>
								</TableRow>
							)}
							{provider.keys.map((key, index) => {
								const isKeyEnabled = key.enabled ?? true;
								const testResult = testResults.get(index);
								return (
									<TableRow key={index} data-testid={`key-row-${key.name}`} className="text-sm transition-colors hover:bg-white" onClick={() => {}}>
										<TableCell>
											<div className="flex items-center space-x-2">
												{key.status === "success" && (
													<Tooltip>
														<TooltipTrigger asChild>
															<button type="button" aria-label="Key status: list models working" data-testid={`key-status-success-${key.name}`} className="inline-flex">
																<CheckCircle2 aria-hidden className="text-green-600 h-4 w-4 flex-shrink-0" />
															</button>
														</TooltipTrigger>
														<TooltipContent>List models working</TooltipContent>
													</Tooltip>
												)}
												{key.status === "list_models_failed" && (
													<Tooltip>
														<TooltipTrigger asChild>
															<button type="button" aria-label="Key status: list models failed" data-testid={`key-status-error-${key.name}`} className="inline-flex">
																<AlertCircle aria-hidden className="text-destructive h-4 w-4 flex-shrink-0" />
															</button>
														</TooltipTrigger>
														<TooltipContent className="max-w-xs break-words">
															{key.description || "Model discovery failed for this key"}
														</TooltipContent>
													</Tooltip>
												)}
												<span className="font-mono text-sm">{key.name}</span>
											</div>
										</TableCell>
										<TableCell data-testid="key-weight-value">
											<div className="flex items-center space-x-2">
												<span className="font-mono text-sm">{key.weight}</span>
											</div>
										</TableCell>
										<TableCell>
											<Switch
												data-testid="key-enabled-switch"
												checked={isKeyEnabled}
												size="md"
												disabled={!hasUpdateProviderAccess}
												onAsyncCheckedChange={async (checked) => {
													await updateProvider({
														...provider,
														keys: provider.keys.map((k, i) => (i === index ? { ...k, enabled: checked } : k)),
													})
														.unwrap()
														.then(() => {
															toast.success(`${EntityLabel} ${checked ? "enabled" : "disabled"} successfully`);
														})
														.catch((err) => {
															toast.error(`Failed to update ${entityLabel}`, { description: getErrorMessage(err) });
														});
												}}
											/>
										</TableCell>
										<TableCell>
											<div className="flex items-center space-x-2">
												{testResult?.loading ? (
													<span className="text-muted-foreground animate-pulse text-xs">Testing...</span>
												) : testResult?.success === true ? (
													<div className="flex items-center gap-1">
														<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
														<span className="font-mono text-green-600 text-xs">{testResult.latencyMs}ms</span>
													</div>
												) : testResult?.success === false ? (
													<div className="flex items-center gap-1">
														<AlertCircle className="h-3.5 w-3.5 text-destructive" />
														<span className="font-mono text-destructive text-xs">{testResult.latencyMs}ms</span>
													</div>
												) : (
													<span className="text-muted-foreground text-xs">—</span>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end space-x-2">
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															onClick={(e) => {
																e.stopPropagation();
																handleTestKey(index);
															}}
															variant="ghost"
															size="icon"
															disabled={testResult?.loading}
														>
															{testResult?.loading ? (
																<ZapIcon className="h-4 w-4 animate-pulse" />
															) : testResult?.success === true ? (
																<CheckCircle2 className="h-4 w-4 text-green-600" />
															) : testResult?.success === false ? (
																<AlertCircle className="h-4 w-4 text-destructive" />
															) : (
																<ZapIcon className="h-4 w-4" />
															)}
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														{testResult?.loading
															? "Testing connectivity..."
															: testResult?.success === true
																? `Tested: ${testResult.latencyMs}ms — Click to retest`
																: testResult?.success === false
																	? `Test failed (${testResult.latencyMs}ms) — Click to retest`
																	: "Test connectivity"}
													</TooltipContent>
												</Tooltip>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button onClick={(e) => e.stopPropagation()} variant="ghost">
															<EllipsisIcon className="h-5 w-5" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onClick={() => {
																handleTestKey(index);
															}}
														>
															<ZapIcon className="mr-1 h-4 w-4" />
															Test Connectivity
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => {
																setShowAddNewKeyDialog({ show: true, keyIndex: index });
															}}
															disabled={!hasUpdateProviderAccess || !isKeyEnabled}
														>
															<PencilIcon className="mr-1 h-4 w-4" />
															Edit
														</DropdownMenuItem>
														<DropdownMenuItem
															variant="destructive"
															onClick={() => {
																setShowDeleteKeyDialog({ show: true, keyIndex: index });
															}}
															disabled={!hasDeleteProviderAccess}
														>
															<TrashIcon className="mr-1 h-4 w-4" />
															Delete
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
