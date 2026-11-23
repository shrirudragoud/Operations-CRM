"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, CarouselViewport } from "@ui-sdk/react/carousel";
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog";
import { removeTaskAttachment, restoreTaskAttachment } from "@/lib/actions/task-files";
import { type FileView, fileByline, fileSummary } from "@/lib/task-file-view";

export type FileLayout = "grid" | "list";

function DocIcon({ mime }: { mime: string }) {
  if (mime.includes("spreadsheet") || mime === "text/csv") return <FileSpreadsheetIcon aria-hidden />;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word") || mime.includes("presentation")) return <FileTextIcon aria-hidden />;
  return <FileIcon aria-hidden />;
}

function Thumb({ file, onOpen }: { file: FileView; onOpen: (id: string) => void }) {
  if (file.kind === "image") {
    return (
      <Button
        type="button"
        aria-label={`Open ${file.name}`}
        className="bg-muted block size-full overflow-hidden rounded-md p-0"
        onClick={() => onOpen(file.id)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private route, served as-is */}
        <img src={file.href} alt="" loading="lazy" className="size-full object-cover" />
      </Button>
    );
  }
  return (
    <div className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-md [&_svg]:size-8">
      <DocIcon mime={file.mime} />
    </div>
  );
}

function FileActions({ file }: { file: FileView }) {
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await removeTaskAttachment({ id: file.id });
      if (!res.ok) return void toast.error(res.error);
      toast(`Removed ${file.name}`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            void restoreTaskAttachment({ id: file.id }).then((r) => {
              if (!r.ok) toast.error(r.error);
            });
          },
        },
      });
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <a
        href={file.href}
        download={file.name}
        aria-label={`Download ${file.name}`}
        className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md [&_svg]:size-4"
      >
        <DownloadIcon aria-hidden />
      </a>
      {file.canRemove && (
        <Button
          type="button"
          aria-label={`Remove ${file.name}`}
          disabled={pending}
          className="flex size-8 items-center justify-center rounded-md p-0 [&_svg]:size-4"
          onClick={remove}
        >
          <Trash2Icon aria-hidden />
        </Button>
      )}
    </div>
  );
}

function Lightbox({ images, startId, onClose }: { images: FileView[]; startId: string | null; onClose: () => void }) {
  const start = Math.max(0, images.findIndex((i) => i.id === startId));
  const [page, setPage] = useState(start + 1);
  const current = images[page - 1] ?? images[0];
  return (
    <Dialog open={startId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogBackdrop className="fixed inset-0 z-50 bg-black/70" />
      <DialogContent className="bg-background fixed inset-0 z-50 m-auto grid h-fit max-h-[calc(100dvh-2rem)] w-[min(94vw,60rem)] gap-3 rounded-xl p-4">
        <DialogTitle className="truncate pr-10 text-sm font-medium">{current?.name ?? "Image"}</DialogTitle>
        <DialogDescription className="sr-only">Images on this task. Use the arrow keys to move between them.</DialogDescription>
        <Carousel aria-label="Images" page={page} onPageChange={(next) => setPage(next)}>
          <div className="flex items-center gap-2">
            {images.length > 1 && (
              <CarouselPrevious aria-label="Previous image"><ChevronLeftIcon aria-hidden /></CarouselPrevious>
            )}
            <CarouselViewport className="min-w-0 flex-1">
              <CarouselContent>
                {images.map((img) => (
                  <CarouselItem key={img.id} className="flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private route, served as-is */}
                    <img src={img.href} alt={img.name} className="max-h-[70dvh] max-w-full object-contain" />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </CarouselViewport>
            {images.length > 1 && (
              <CarouselNext aria-label="Next image"><ChevronRightIcon aria-hidden /></CarouselNext>
            )}
          </div>
        </Carousel>
        {current && <p className="text-muted-foreground text-xs">{fileSummary(current)}, {fileByline(current)}</p>}
        <DialogClose aria-label="Close" className="absolute top-3 right-3"><XIcon aria-hidden /></DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/** Files as thumbnails or rows. Images open in a viewer; everything can be downloaded; removable ones get an Undo toast. */
export function FileList({ files, layout = "list", label = "Files" }: { files: FileView[]; layout?: FileLayout; label?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const images = files.filter((f) => f.kind === "image");

  return (
    <>
      {layout === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label={label}>
          {files.map((f) => (
            <li key={f.id} className="space-y-1.5">
              <div className="aspect-[4/3]"><Thumb file={f} onOpen={setOpenId} /></div>
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{fileSummary(f)}</p>
                  <p className="text-muted-foreground truncate text-xs">{fileByline(f)}</p>
                </div>
                <FileActions file={f} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-1.5" aria-label={label}>
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-md border p-2">
              <div className="size-12 shrink-0"><Thumb file={f} onOpen={setOpenId} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                <p className="text-muted-foreground truncate text-xs">{fileSummary(f)}, {fileByline(f)}</p>
              </div>
              <FileActions file={f} />
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && <Lightbox key={openId ?? "closed"} images={images} startId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
